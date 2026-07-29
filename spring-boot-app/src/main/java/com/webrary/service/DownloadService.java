package com.webrary.service;

import com.webrary.dto.BookAddRequest;
import com.webrary.dto.DownloadInfo;
import com.webrary.dto.DownloadTask;
import com.webrary.model.Book;
import com.webrary.repository.BookRepository;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;

/**
 * 后台下载服务 — 管理异步下载任务的生命周期（创建、状态跟踪、完成处理）。
 * 使用线程池执行下载，支持进度回调和多书架分配。
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class DownloadService {

    private final ZlibraryService zlibraryService;
    private final BookService bookService;
    private final BookRepository bookRepository;

    // 上传文件存储目录
    @Value("${webrary.upload.dir:data/uploads}")
    private String uploadDir;

    // 任务存储（线程安全）
    private final ConcurrentHashMap<String, DownloadTask> tasks = new ConcurrentHashMap<>();
    // 下载线程池（最多3个并发下载）
    private final ExecutorService executor = Executors.newFixedThreadPool(3);

    /**
     * 启动一个新的后台下载任务。
     * @param session 当前用户的 HttpSession
     * @param zlibId Z-Library 书籍 ID
     * @param zlibHash Z-Library 书籍哈希
     * @param title 书名
     * @param author 作者
     * @param coverUrl 封面 URL
     * @param extension 文件扩展名
     * @param filesize 文件大小
     * @param description 书籍简介
     * @param shelfIds 要添加到的书架 ID 列表
     * @return 任务 ID（UUID）
     */
    public String startDownload(HttpSession session, Long zlibId, String zlibHash,
                                 String title, String author, String coverUrl, String extension,
                                 Long filesize, String description, List<Long> shelfIds) {
        String taskId = UUID.randomUUID().toString();
        // 创建下载任务记录，初始状态为 DOWNLOADING
        DownloadTask task = DownloadTask.builder()
                .taskId(taskId)
                .title(title)
                .author(author)
                .coverUrl(coverUrl)
                .extension(extension)
                .totalBytes(filesize)
                .downloadedBytes(0L)
                .status("DOWNLOADING")
                .createdAt(LocalDateTime.now())
                .build();
        tasks.put(taskId, task);

        // 提交到线程池异步执行
        executor.submit(() -> executeDownload(session, zlibId, zlibHash, task, description, shelfIds));

        return taskId;
    }

    /**
     * 执行下载的核心逻辑（在后台线程中运行）。
     * 流程: 获取下载链接 → 下载文件 → 保存到磁盘 → 格式转换 → 创建/更新 Book 记录 → 添加到书架。
     */
    private void executeDownload(HttpSession session, Long zlibId, String zlibHash,
                                  DownloadTask task, String description, List<Long> shelfIds) {
        try {
            // 获取下载链接并更新文件大小信息
            DownloadInfo info = zlibraryService.getDownloadLink(session, zlibId, zlibHash);
            if (info.getFilesize() != null) task.setTotalBytes(info.getFilesize());
            String ext = info.getExtension() != null ? info.getExtension()
                    : (task.getExtension() != null ? task.getExtension() : "bin");

            // 带进度的文件下载
            byte[] fileBytes = zlibraryService.downloadBookWithProgress(session, zlibId, zlibHash,
                    bytes -> task.setDownloadedBytes(bytes));

            // 保存文件到磁盘
            task.setStatus("SAVING");
            Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
            if (!Files.exists(uploadPath)) Files.createDirectories(uploadPath);
            String filename = UUID.randomUUID().toString() + "." + ext;
            Path savedPath = uploadPath.resolve(filename);
            Files.write(savedPath, fileBytes);

            // 格式转换（MOBI/AZW3 → EPUB）
            task.setStatus("CONVERTING");
            Path finalPath = autoConvertIfNeeded(savedPath, ext);
            String finalExt = finalPath.equals(savedPath) ? ext : "epub";

            // 查找或创建 Book 记录
            Book book = bookRepository.findByZlibId(zlibId).orElse(null);
            if (book == null) {
                // 创建新的书籍记录
                book = Book.builder()
                        .zlibId(zlibId)
                        .zlibHash(zlibHash != null ? zlibHash : "")
                        .title(task.getTitle())
                        .author(task.getAuthor())
                        .coverUrl(task.getCoverUrl())
                        .extension(finalExt)
                        .filesize((long) fileBytes.length)
                        .description(description)
                        .filePath(finalPath.toString())
                        .uploaded(true)
                        .build();
                book = bookRepository.save(book);
            } else {
                // 更新已有书籍记录的文件路径
                book.setFilePath(finalPath.toString());
                book.setUploaded(true);
                book.setExtension(finalExt);
                book.setFilesize((long) fileBytes.length);
                bookRepository.save(book);
            }
            task.setBookId(book.getId());

            // 将书籍添加到指定的书架列表
            if (shelfIds != null && !shelfIds.isEmpty()) {
                for (Long shelfId : shelfIds) {
                    try {
                        BookAddRequest req = BookAddRequest.builder()
                                .zlibId(zlibId)
                                .zlibHash(zlibHash)
                                .title(task.getTitle())
                                .author(task.getAuthor())
                                .coverUrl(task.getCoverUrl())
                                .extension(finalExt)
                                .filesize((long) fileBytes.length)
                                .description(description)
                                .build();
                        bookService.addBookToShelf(shelfId, req);
                    } catch (Exception e) {
                        log.warn("Failed to add book to shelf {}: {}", shelfId, e.getMessage());
                    }
                }
            }

            // 标记任务完成
            task.setStatus("COMPLETED");
            task.setDownloadedBytes(task.getTotalBytes());
            log.info("Download complete: {} -> {}", task.getTitle(), finalPath.getFileName());
        } catch (Exception e) {
            // 下载失败，记录错误信息
            log.error("Download failed [{}]: {}", task.getTitle(), e.getMessage(), e);
            task.setStatus("FAILED");
            task.setErrorMessage(e.getMessage());
        }
    }

    /**
     * 检查并尝试自动转换 MOBI/AZW3 格式到 EPUB。
     * （当前 Calibre 转换已移除，仅记录警告日志）
     */
    private Path autoConvertIfNeeded(Path filePath, String ext) {
        try {
            String lower = ext != null ? ext.toLowerCase() : "";
            if (lower.equals("mobi") || lower.equals("azw3")) {
                log.warn("MOBI/AZW3 book downloaded; no EPUB conversion available (Calibre removed)");
            }
        } catch (Exception e) {
            log.warn("Format check failed for {}: {}", filePath, e.getMessage());
        }
        return filePath;
    }

    /**
     * 根据任务 ID 查询下载任务。
     */
    public DownloadTask getTask(String taskId) {
        return tasks.get(taskId);
    }

    /**
     * 获取所有下载任务列表（按创建时间降序排列）。
     */
    public List<DownloadTask> getAllTasks() {
        List<DownloadTask> list = new ArrayList<>(tasks.values());
        list.sort((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()));
        return list;
    }

    /**
     * 清除已完成和失败的任务。
     */
    public void clearCompleted() {
        tasks.values().removeIf(t -> "COMPLETED".equals(t.getStatus()) || "FAILED".equals(t.getStatus()));
    }
}
