package com.webrary.controller;

import com.webrary.dto.*;
import com.webrary.model.ShelfBook;
import com.webrary.repository.BookRepository;
import com.webrary.service.BookService;
import com.webrary.service.CalibreConverter;
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
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/zlibrary")
@RequiredArgsConstructor
@Slf4j
public class ZlibraryController {

    private final ZlibraryService zlibraryService;
    private final BookService bookService;
    private final BookRepository bookRepository;
    private final CalibreConverter calibreConverter;

    @Value("${webrary.upload-dir:./data/uploads}")
    private String uploadDir;

    @PostMapping("/login")
    public ApiResponse<ZlibraryUserInfo> login(@RequestBody Map<String, String> loginRequest,
                                                HttpSession session) {
        try {
            String email = loginRequest.get("email");
            String password = loginRequest.get("password");
            String domain = loginRequest.getOrDefault("domain", null);
            String proxyHost = loginRequest.getOrDefault("proxyHost", null);
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

    @GetMapping("/logout")
    public ApiResponse<Void> logout(HttpSession session) {
        zlibraryService.logout(session);
        return ApiResponse.success("Logged out", null);
    }

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

            DownloadInfo downloadInfo = zlibraryService.getDownloadLink(session, zlibId, zlibHash);
            byte[] fileBytes = zlibraryService.downloadBook(session, zlibId, zlibHash);

            // Save to server disk
            String ext = downloadInfo.getExtension() != null ? downloadInfo.getExtension() : "bin";
            String filename = UUID.randomUUID().toString() + "." + ext;
            Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
            if (!Files.exists(uploadPath)) Files.createDirectories(uploadPath);
            Path savedPath = uploadPath.resolve(filename);
            Files.write(savedPath, fileBytes);

            // Auto-convert MOBI/AZW3 to EPUB
            Path finalPath = autoConvertIfNeeded(savedPath, ext);
            String finalExt = finalPath.equals(savedPath) ? ext : "epub";

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

            // If converted, serve the EPUB bytes instead
            byte[] responseBytes = finalPath.equals(savedPath) ? fileBytes : Files.readAllBytes(finalPath);
            return buildFileResponse(responseBytes, finalExt, finalPath.getFileName().toString());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("Download failed: " + e.getMessage()));
        }
    }

    private ResponseEntity<byte[]> buildFileResponse(byte[] bytes, String extension, String filename) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentDispositionFormData("attachment", filename);
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

    @GetMapping("/status")
    public ApiResponse<Map<String, Boolean>> status(HttpSession session) {
        return ApiResponse.success(Map.of("loggedIn", zlibraryService.isLoggedIn(session)));
    }

    /**
     * Auto-convert MOBI/AZW3 files to EPUB after download.
     * Returns the final file path (converted EPUB if applicable, original otherwise).
     */
    private Path autoConvertIfNeeded(Path savedPath, String extension) {
        if (extension == null) return savedPath;
        String extLower = extension.toLowerCase().replace(".", "");
        if (!extLower.equals("mobi") && !extLower.equals("azw3")) return savedPath;

        try {
            log.info("Auto-converting downloaded {} file to EPUB: {}", extLower, savedPath);
            Path epubPath = calibreConverter.convertToEpub(savedPath);
            log.info("Auto-conversion complete: {}", epubPath);
            return epubPath;
        } catch (Exception e) {
            log.warn("Auto-conversion to EPUB failed, keeping original: {}", e.getMessage());
            return savedPath;
        }
    }

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

            String safeName = shelfName.replaceAll("[\\\\/:*?\"<>|]", "_");
            String ext = info.getExtension() != null ? "." + info.getExtension() : ".bin";
            String filename = UUID.randomUUID().toString() + ext;
            Path uploadPath = Paths.get(uploadDir, safeName).toAbsolutePath().normalize();
            if (!Files.exists(uploadPath)) Files.createDirectories(uploadPath);
            Path filePath = uploadPath.resolve(filename);
            Files.write(filePath, bytes);

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

            // Get shelf name for folder organization
            String shelfName = metadata.getOrDefault("shelfName", "默认书架");

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

            // Auto-convert MOBI/AZW3 to EPUB
            Path finalPath = autoConvertIfNeeded(filePath, ext.replace(".", ""));
            String finalExt = finalPath.equals(filePath) ? ext.replace(".", "") : "epub";

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

            // Update book with filePath (pointing to converted EPUB if applicable)
            shelfBook.getBook().setFilePath(finalPath.toString());
            shelfBook.getBook().setUploaded(true);

            return ApiResponse.success(shelfBook);
        } catch (Exception e) {
            return ApiResponse.error("Failed: " + e.getMessage());
        }
    }
}
