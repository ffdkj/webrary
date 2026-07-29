package com.webrary.controller;

import com.webrary.dto.*;
import com.webrary.model.ShelfBook;
import com.webrary.repository.BookRepository;
import com.webrary.service.BookService;
import com.webrary.service.DownloadService;
import com.webrary.service.ZlibraryService;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Z-Library 集成控制器 — Z-Library 登录、搜索、下载、添加到书架以及后台下载管理。
 */
@RestController
@RequestMapping("/api/zlibrary")
@RequiredArgsConstructor
@Slf4j
public class ZlibraryController {

    private final ZlibraryService zlibraryService;
    private final BookService bookService;
    private final BookRepository bookRepository;
    private final DownloadService downloadService;

    // 上传文件存储目录
    @Value("${webrary.upload-dir:./data/uploads}")
    private String uploadDir;

    /**
     * Z-Library 登录 — 通过邮箱密码登录，支持自定义域名和代理。
     */
    @PostMapping("/login")
    public ApiResponse<ZlibraryUserInfo> login(@RequestBody Map<String, String> loginRequest,
                                                HttpSession session) {
        try {
            String email = loginRequest.get("email");
            String password = loginRequest.get("password");
            String domain = loginRequest.getOrDefault("domain", null);
            String proxyHost = loginRequest.getOrDefault("proxyHost", null);
            // 解析代理端口
            Integer proxyPort = null;
            if (loginRequest.containsKey("proxyPort") && loginRequest.get("proxyPort") != null
                    && !loginRequest.get("proxyPort").isBlank()) {
                try { proxyPort = Integer.parseInt(loginRequest.get("proxyPort")); } catch (NumberFormatException e) { }
            }

            if (email == null || password == null) {
                return ApiResponse.error("Email and password are required");
            }

            ZlibraryUserInfo userInfo = zlibraryService.login(session, email, password, domain, proxyHost, proxyPort);
            return ApiResponse.success("Login successful", userInfo);
        } catch (Exception e) {
            return ApiResponse.error("Login failed: " + e.getMessage());
        }
    }

    /**
     * 获取 Z-Library 用户个人信息
     */
    @GetMapping("/profile")
    public ApiResponse<ZlibraryUserInfo> getProfile(HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ApiResponse.error("Not logged in");
            }
            ZlibraryUserInfo profile = zlibraryService.getProfile(session);
            return ApiResponse.success(profile);
        } catch (Exception e) {
            return ApiResponse.error("Failed to get profile: " + e.getMessage());
        }
    }

    /**
     * 获取当日剩余下载次数
     */
    @GetMapping("/downloads-left")
    public ApiResponse<Integer> getDownloadsLeft(HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ApiResponse.error("Not logged in");
            }
            ZlibraryUserInfo profile = zlibraryService.getProfile(session);
            int left = profile.getDownloadsLimit() - profile.getDownloadsToday();
            return ApiResponse.success(Math.max(0, left));
        } catch (Exception e) {
            return ApiResponse.error("Failed: " + e.getMessage());
        }
    }

    /**
     * Z-Library 登出
     */
    @GetMapping("/logout")
    public ApiResponse<Void> logout(HttpSession session) {
        zlibraryService.logout(session);
        return ApiResponse.success("Logged out", null);
    }

    /**
     * 搜索 Z-Library 书籍 — 支持按年份、语言、格式、排序等筛选。
     */
    @PostMapping("/search")
    public ApiResponse<SearchResult> search(@RequestBody SearchRequest request, HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ApiResponse.error("Not logged in");
            }
            SearchResult result = zlibraryService.search(session, request);
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error("Search failed: " + e.getMessage());
        }
    }

    /**
     * 获取 Z-Library 书籍详细信息
     */
    @GetMapping("/book/{bookId}/{hash}")
    public ApiResponse<Object> getBookInfo(@PathVariable Long bookId, @PathVariable String hash,
                                            HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ApiResponse.error("Not logged in");
            }
            Object bookInfo = zlibraryService.getBookInfo(session, bookId, hash);
            return ApiResponse.success(bookInfo);
        } catch (Exception e) {
            return ApiResponse.error("Failed to get book info: " + e.getMessage());
        }
    }

    /**
     * 获取 Z-Library 书籍的下载链接信息
     */
    @GetMapping("/book/{bookId}/{hash}/download")
    public ApiResponse<DownloadInfo> getDownloadLink(@PathVariable Long bookId, @PathVariable String hash,
                                                       HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ApiResponse.error("Not logged in");
            }
            DownloadInfo downloadInfo = zlibraryService.getDownloadLink(session, bookId, hash);
            return ApiResponse.success(downloadInfo);
        } catch (Exception e) {
            return ApiResponse.error("Failed to get download link: " + e.getMessage());
        }
    }

    /**
     * 从 Z-Library 下载书籍文件，保存到服务器本地，并返回文件给浏览器。
     * URL 参数: zlibId 和 zlibHash 标识 Z-Library 上的书籍。
     * 查询参数: localBookId 关联本地图书实体，用于关联已保存的文件。
     */
    /** Download from Z-Library, save to server, and serve file to browser.
     *  URL params: zlibId and zlibHash of the book on Z-Library.
     *  Query param: localBookId — the local Book entity DB ID to associate saved file with. */
    @GetMapping("/book/{zlibId}/{zlibHash}/download/file")
    public ResponseEntity<?> downloadBook(@PathVariable Long zlibId, @PathVariable String zlibHash,
                                            @RequestParam(required = false) Long localBookId,
                                            HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .body(ApiResponse.error("Not logged in"));
            }

            // 检查是否已有本地文件缓存，直接返回
            // Check if we already have a local file
            if (localBookId != null) {
                var bookOpt = bookRepository.findById(localBookId);
                if (bookOpt.isPresent() && bookOpt.get().getFilePath() != null) {
                    var book = bookOpt.get();
                    Path localPath = Path.of(book.getFilePath());
                    if (localPath.toFile().exists()) {
                        byte[] cachedBytes = Files.readAllBytes(localPath);
                        return buildFileResponse(cachedBytes, book.getExtension(),
                                localPath.getFileName().toString());
                    }
                }
            }

            // 获取下载链接并下载文件内容
            DownloadInfo downloadInfo = zlibraryService.getDownloadLink(session, zlibId, zlibHash);
            byte[] fileBytes = zlibraryService.downloadBook(session, zlibId, zlibHash);

            // 保存到服务器磁盘
            // Save to server disk
            String ext = downloadInfo.getExtension() != null ? downloadInfo.getExtension() : "bin";
            String filename = UUID.randomUUID().toString() + "." + ext;
            Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
            if (!Files.exists(uploadPath)) Files.createDirectories(uploadPath);
            Path savedPath = uploadPath.resolve(filename);
            Files.write(savedPath, fileBytes);

            // 自动转换 MOBI/AZW3 到 EPUB 格式
            // Auto-convert MOBI/AZW3 to EPUB
            Path finalPath = autoConvertIfNeeded(savedPath, ext);
            String finalExt = finalPath.equals(savedPath) ? ext : "epub";

            // 更新本地 Book 记录，关联已下载的文件路径
            // Update local Book record if we have one
            if (localBookId != null) {
                final long savedSize = fileBytes.length;
                final String finalPathStr = finalPath.toString();
                bookRepository.findById(localBookId).ifPresent(book -> {
                    book.setFilePath(finalPathStr);
                    book.setUploaded(true);
                    if (book.getExtension() == null || book.getExtension().isBlank()) {
                        book.setExtension(finalExt);
                    } else if (!finalExt.equals(ext)) {
                        book.setExtension(finalExt);
                    }
                    if (book.getFilesize() == null || book.getFilesize() == 0) {
                        book.setFilesize(savedSize);
                    }
                    bookRepository.save(book);
                });
            } else {
                final long savedSize = fileBytes.length;
                final String finalPathStr = finalPath.toString();
                // 如果没有提供 localBookId，尝试按 zlibId 查找书本记录
                // If no localBookId provided, try to find book by zlibId
                bookRepository.findByZlibId(zlibId).ifPresent(book -> {
                    book.setFilePath(finalPathStr);
                    book.setUploaded(true);
                    if (book.getExtension() == null || book.getExtension().isBlank()) {
                        book.setExtension(finalExt);
                    } else if (!finalExt.equals(ext)) {
                        book.setExtension(finalExt);
                    }
                    if (book.getFilesize() == null || book.getFilesize() == 0) {
                        book.setFilesize(savedSize);
                    }
                    bookRepository.save(book);
                });
            }

            // 如果发生了格式转换，则返回转换后的 EPUB 文件内容
            // If converted, serve the EPUB bytes instead
            byte[] responseBytes = finalPath.equals(savedPath) ? fileBytes : Files.readAllBytes(finalPath);
            return buildFileResponse(responseBytes, finalExt, finalPath.getFileName().toString());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("Download failed: " + e.getMessage()));
        }
    }

    /**
     * 构建文件下载的 HTTP 响应，设置合适的 Content-Type 和文件名。
     */
    private ResponseEntity<byte[]> buildFileResponse(byte[] bytes, String extension, String filename) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentDispositionFormData("attachment", filename);
        // 根据扩展名确定 MIME 类型
        String contentType = "application/octet-stream";
        if (extension != null) {
            contentType = switch (extension.toLowerCase().replace(".", "")) {
                case "pdf" -> "application/pdf";
                case "epub" -> "application/epub+zip";
                case "mobi" -> "application/x-mobipocket-ebook";
                case "txt" -> "text/plain";
                default -> "application/octet-stream";
            };
        }
        return ResponseEntity.ok()
                .headers(headers)
                .contentType(MediaType.parseMediaType(contentType))
                .body(bytes);
    }

    /**
     * 获取 Z-Library 最受欢迎书籍列表
     */
    @GetMapping("/most-popular")
    public ApiResponse<SearchResult> getMostPopular(HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ApiResponse.error("Not logged in");
            }
            SearchResult result = zlibraryService.getMostPopular(session);
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error("Failed to get most popular: " + e.getMessage());
        }
    }

    /**
     * 检查 Z-Library 登录状态
     */
    @GetMapping("/status")
    public ApiResponse<Map<String, Boolean>> status(HttpSession session) {
        return ApiResponse.success(Map.of("loggedIn", zlibraryService.isLoggedIn(session)));
    }

    /**
     * 下载后自动将 MOBI/AZW3 文件转换为 EPUB 格式。
     * 返回最终文件路径（若需转换则为 EPUB 路径，否则原路径）。
     */
    /**
     * Auto-convert MOBI/AZW3 files to EPUB after download.
     * Returns the final file path (converted EPUB if applicable, original otherwise).
     */
    private Path autoConvertIfNeeded(Path savedPath, String extension) {
        if (extension == null) return savedPath;
        String extLower = extension.toLowerCase().replace(".", "");
        if (extLower.equals("mobi") || extLower.equals("azw3")) {
            log.warn("MOBI/AZW3 format downloaded; no EPUB conversion available (Calibre removed)");
        }
        return savedPath;
    }

    /**
     * 服务器端下载 — 保存 Z-Library 书籍到书架对应文件夹，返回保存的文件信息。
     */
    /** Server-side download: saves Z-Library book to disk under bookshelf folder, returns saved file info */
    @PostMapping("/download-save/{bookId}/{hash}")
    public ApiResponse<Map<String, String>> downloadAndSave(@PathVariable Long bookId,
                                                              @PathVariable String hash,
                                                              @RequestParam(defaultValue = "默认书架") String shelfName,
                                                              HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ApiResponse.error("Not logged in");
            }

            DownloadInfo info = zlibraryService.getDownloadLink(session, bookId, hash);
            byte[] bytes = zlibraryService.downloadBook(session, bookId, hash);

            // 清理文件夹名，防止非法字符
            String safeName = shelfName.replaceAll("[\\\\/:*?\"<>|]", "_");
            String ext = info.getExtension() != null ? "." + info.getExtension() : ".bin";
            String filename = UUID.randomUUID().toString() + ext;
            Path uploadPath = Paths.get(uploadDir, safeName).toAbsolutePath().normalize();
            if (!Files.exists(uploadPath)) Files.createDirectories(uploadPath);
            Path filePath = uploadPath.resolve(filename);
            Files.write(filePath, bytes);

            // 自动转换 MOBI/AZW3 到 EPUB
            // Auto-convert MOBI/AZW3 to EPUB
            Path finalPath = autoConvertIfNeeded(filePath, ext.replace(".", ""));
            String finalExt = finalPath.equals(filePath) ? ext.replace(".", "") : "epub";

            String relativePath = "/uploads/" + safeName + "/" + finalPath.getFileName().toString();
            return ApiResponse.success(Map.of(
                "filePath", finalPath.toString(),
                "relativePath", relativePath,
                "filename", finalPath.getFileName().toString(),
                "extension", finalExt,
                "filesize", String.valueOf(bytes.length)
            ));
        } catch (Exception e) {
            return ApiResponse.error("Save failed: " + e.getMessage());
        }
    }

    /**
     * 从 Z-Library 下载书籍，保存到磁盘，并添加到指定书架。
     */
    /** Download from Z-Library, save to disk under shelf folder, and add to shelf */
    @PostMapping("/add-to-shelf/{bookId}/{hash}/{shelfId}")
    public ApiResponse<ShelfBook> addToShelfWithDownload(@PathVariable Long bookId,
                                                           @PathVariable String hash,
                                                           @PathVariable Long shelfId,
                                                           @RequestBody Map<String, String> metadata,
                                                           HttpSession session) {
        try {
            if (!zlibraryService.isLoggedIn(session)) {
                return ApiResponse.error("Not logged in");
            }

            // 获取书架名称用于文件夹组织
            // Get shelf name for folder organization
            String shelfName = metadata.getOrDefault("shelfName", "默认书架");

            // 下载并保存文件
            // Download and save file
            DownloadInfo info = zlibraryService.getDownloadLink(session, bookId, hash);
            byte[] bytes = zlibraryService.downloadBook(session, bookId, hash);

            String safeName = shelfName.replaceAll("[\\\\/:*?\"<>|]", "_");
            String ext = info.getExtension() != null ? "." + info.getExtension() : ".bin";
            String filename = UUID.randomUUID().toString() + ext;
            Path uploadPath = Paths.get(uploadDir, safeName).toAbsolutePath().normalize();
            if (!Files.exists(uploadPath)) Files.createDirectories(uploadPath);
            Path filePath = uploadPath.resolve(filename);
            Files.write(filePath, bytes);

            // 自动转换 MOBI/AZW3 到 EPUB
            // Auto-convert MOBI/AZW3 to EPUB
            Path finalPath = autoConvertIfNeeded(filePath, ext.replace(".", ""));
            String finalExt = finalPath.equals(filePath) ? ext.replace(".", "") : "epub";

            // 构建 BookAddRequest，包含文件路径
            // Create BookAddRequest with filePath
            BookAddRequest req = new BookAddRequest();
            req.setZlibId(bookId);
            req.setZlibHash(hash);
            req.setTitle(metadata.getOrDefault("title", ""));
            req.setAuthor(metadata.getOrDefault("author", ""));
            req.setCoverUrl(metadata.getOrDefault("coverUrl", ""));
            req.setExtension(finalExt);
            req.setFilesize((long) bytes.length);
            req.setDescription(metadata.getOrDefault("description", ""));

            ShelfBook shelfBook = bookService.addBookToShelf(shelfId, req);

            // 更新书本文件路径（如果转换了则指向 EPUB 文件）
            // Update book with filePath (pointing to converted EPUB if applicable)
            shelfBook.getBook().setFilePath(finalPath.toString());
            shelfBook.getBook().setUploaded(true);

            return ApiResponse.success(shelfBook);
        } catch (Exception e) {
            return ApiResponse.error("Failed: " + e.getMessage());
        }
    }

    // ── 后台下载端点 ──
    // ── Background Download Endpoints ──

    /**
     * 启动后台异步下载任务
     */
    @PostMapping("/download/start")
    public ApiResponse<Map<String, String>> startBackgroundDownload(
            @RequestBody Map<String, Object> request,
            HttpSession session) {
        try {
            // 从请求参数中提取下载所需信息
            Long zlibId = Long.valueOf(request.get("zlibId").toString());
            String zlibHash = (String) request.get("zlibHash");
            String title = (String) request.get("title");
            String author = (String) request.get("author");
            String coverUrl = (String) request.get("coverUrl");
            String extension = (String) request.get("extension");
            Long filesize = request.get("filesize") != null
                    ? Long.valueOf(request.get("filesize").toString()) : null;
            String description = (String) request.get("description");

            // 解析书架 ID 列表（支持数字和字符串两种格式）
            @SuppressWarnings("unchecked")
            Object rawShelfIds = request.get("shelfIds");
            List<Long> shelfIds = null;
            if (rawShelfIds instanceof List<?> rawList) {
                shelfIds = new java.util.ArrayList<>();
                for (Object item : rawList) {
                    if (item instanceof Number n) {
                        shelfIds.add(n.longValue());
                    } else if (item instanceof String s) {
                        shelfIds.add(Long.valueOf(s));
                    }
                }
            }

            String taskId = downloadService.startDownload(
                    session, zlibId, zlibHash, title, author, coverUrl,
                    extension, filesize, description, shelfIds);

            return ApiResponse.success(Map.of("taskId", taskId));
        } catch (Exception e) {
            return ApiResponse.error("Failed: " + e.getMessage());
        }
    }

    /**
     * 查询后台下载任务状态
     */
    @GetMapping("/download/status/{taskId}")
    public ApiResponse<DownloadTask> getDownloadStatus(@PathVariable String taskId) {
        DownloadTask task = downloadService.getTask(taskId);
        if (task == null) return ApiResponse.error("Task not found: " + taskId);
        return ApiResponse.success(task);
    }

    /**
     * 获取所有下载任务列表
     */
    @GetMapping("/download/list")
    public ApiResponse<List<DownloadTask>> getDownloadList() {
        return ApiResponse.success(downloadService.getAllTasks());
    }
}
