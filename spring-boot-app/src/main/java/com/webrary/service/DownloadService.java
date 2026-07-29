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

@Service
@Slf4j
@RequiredArgsConstructor
public class DownloadService {

    private final ZlibraryService zlibraryService;
    private final BookService bookService;
    private final BookRepository bookRepository;

    @Value("${webrary.upload.dir:data/uploads}")
    private String uploadDir;

    private final ConcurrentHashMap<String, DownloadTask> tasks = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newFixedThreadPool(3);

    public String startDownload(HttpSession session, Long zlibId, String zlibHash,
                                 String title, String author, String coverUrl, String extension,
                                 Long filesize, String description, List<Long> shelfIds) {
        String taskId = UUID.randomUUID().toString();
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

        executor.submit(() -> executeDownload(session, zlibId, zlibHash, task, description, shelfIds));

        return taskId;
    }

    private void executeDownload(HttpSession session, Long zlibId, String zlibHash,
                                  DownloadTask task, String description, List<Long> shelfIds) {
        try {
            DownloadInfo info = zlibraryService.getDownloadLink(session, zlibId, zlibHash);
            if (info.getFilesize() != null) task.setTotalBytes(info.getFilesize());
            String ext = info.getExtension() != null ? info.getExtension()
                    : (task.getExtension() != null ? task.getExtension() : "bin");

            byte[] fileBytes = zlibraryService.downloadBookWithProgress(session, zlibId, zlibHash,
                    bytes -> task.setDownloadedBytes(bytes));

            task.setStatus("SAVING");
            Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
            if (!Files.exists(uploadPath)) Files.createDirectories(uploadPath);
            String filename = UUID.randomUUID().toString() + "." + ext;
            Path savedPath = uploadPath.resolve(filename);
            Files.write(savedPath, fileBytes);

            task.setStatus("CONVERTING");
            Path finalPath = autoConvertIfNeeded(savedPath, ext);
            String finalExt = finalPath.equals(savedPath) ? ext : "epub";

            Book book = bookRepository.findByZlibId(zlibId).orElse(null);
            if (book == null) {
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
                book.setFilePath(finalPath.toString());
                book.setUploaded(true);
                book.setExtension(finalExt);
                book.setFilesize((long) fileBytes.length);
                bookRepository.save(book);
            }
            task.setBookId(book.getId());

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

            task.setStatus("COMPLETED");
            task.setDownloadedBytes(task.getTotalBytes());
            log.info("Download complete: {} -> {}", task.getTitle(), finalPath.getFileName());
        } catch (Exception e) {
            log.error("Download failed [{}]: {}", task.getTitle(), e.getMessage(), e);
            task.setStatus("FAILED");
            task.setErrorMessage(e.getMessage());
        }
    }

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

    public DownloadTask getTask(String taskId) {
        return tasks.get(taskId);
    }

    public List<DownloadTask> getAllTasks() {
        List<DownloadTask> list = new ArrayList<>(tasks.values());
        list.sort((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()));
        return list;
    }

    public void clearCompleted() {
        tasks.values().removeIf(t -> "COMPLETED".equals(t.getStatus()) || "FAILED".equals(t.getStatus()));
    }
}
