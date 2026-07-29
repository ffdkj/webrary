package com.webrary.controller;

import com.webrary.dto.*;
import com.webrary.model.Book;
import com.webrary.model.ReadingProgress;
import com.webrary.model.ShelfBook;
import com.webrary.repository.BookRepository;
import com.webrary.service.BookService;
import com.webrary.service.EbookParserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;

/**
 * 书籍控制器 — 管理书架中的书籍、上传、阅读进度、目录、文件读取和 PDF 渲染。
 */
@RestController
@RequestMapping("/api/books")
@RequiredArgsConstructor
public class BookController {

    private final BookService bookService;
    private final EbookParserService ebookParserService;
    private final BookRepository bookRepository;

    /**
     * 获取指定书架中的所有书籍（含阅读进度摘要）
     */
    @GetMapping("/shelf/{shelfId}")
    public ApiResponse<List<ShelfBookResponse>> getBooksByShelf(@PathVariable Long shelfId) {
        return ApiResponse.success(bookService.getBooksByShelf(shelfId));
    }

    /**
     * 获取阅读历史记录（按最近阅读排序）
     */
    @GetMapping("/history")
    public ApiResponse<List<HistoryEntry>> getReadingHistory() {
        return ApiResponse.success(bookService.getReadingHistory());
    }

    /**
     * 向书架添加书籍（支持 Z-Library 书籍和本地上传）
     */
    @PostMapping("/shelf/{shelfId}")
    public ApiResponse<ShelfBookResponse> addBookToShelf(@PathVariable Long shelfId,
                                                          @RequestBody BookAddRequest request) {
        ShelfBook sb = bookService.addBookToShelf(shelfId, request);
        ReadingProgress progress = bookService.getReadingProgress(sb.getBook().getId());

        // 计算未读页数
        int unreadPages = 0;
        if (progress.getTotalPages() > 0) {
            unreadPages = progress.getTotalPages() - progress.getCurrentPage();
        }

        // 构建响应对象
        ShelfBookResponse response = ShelfBookResponse.builder()
                .id(sb.getId())
                .bookId(sb.getBook().getId())
                .title(sb.getBook().getTitle())
                .author(sb.getBook().getAuthor())
                .coverUrl(sb.getBook().getCoverUrl())
                .extension(sb.getBook().getExtension())
                .filesize(sb.getBook().getFilesize())
                .unreadPages(unreadPages)
                .isFinished(progress.isFinished())
                .build();

        return ApiResponse.success(response);
    }

    /**
     * 从书架中移除书籍（不删除 Book 实体）
     */
    @DeleteMapping("/shelf/{shelfId}/book/{bookId}")
    public ApiResponse<Void> removeFromShelf(@PathVariable Long shelfId, @PathVariable Long bookId) {
        bookService.removeBookFromShelf(shelfId, bookId);
        return ApiResponse.success("Book removed from shelf", null);
    }

    /**
     * 转移书籍从一个书架到另一个书架
     */
    @PostMapping("/transfer")
    public ApiResponse<Void> transferBook(@RequestBody TransferRequest request) {
        bookService.transferBook(request.getFromShelfId(), request.getToShelfId(), request.getBookId());
        return ApiResponse.success("Book transferred", null);
    }

    /**
     * 彻底删除书籍（从所有书架移除、删除文件、删除记录）
     */
    @DeleteMapping("/{bookId}")
    public ApiResponse<Void> deleteBook(@PathVariable Long bookId) {
        bookService.deleteBook(bookId);
        return ApiResponse.success("Book deleted", null);
    }

    /**
     * 获取书籍详细信息
     */
    @GetMapping("/{bookId}")
    public ApiResponse<ShelfBookResponse> getBookById(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));
        ShelfBookResponse response = ShelfBookResponse.builder()
                .bookId(book.getId())
                .title(book.getTitle())
                .author(book.getAuthor())
                .coverUrl(book.getCoverUrl())
                .extension(book.getExtension())
                .filesize(book.getFilesize())
                .filePath(book.getFilePath())
                .zlibId(book.getZlibId())
                .zlibHash(book.getZlibHash())
                .build();
        return ApiResponse.success(response);
    }

    /**
     * 获取书籍的阅读进度
     */
    @GetMapping("/{bookId}/progress")
    public ApiResponse<ReadingProgress> getReadingProgress(@PathVariable Long bookId) {
        return ApiResponse.success(bookService.getReadingProgress(bookId));
    }

    /**
     * 更新书籍的阅读进度
     */
    @PutMapping("/{bookId}/progress")
    public ApiResponse<ReadingProgress> updateReadingProgress(@PathVariable Long bookId,
                                                               @RequestBody ReadingProgressRequest request) {
        return ApiResponse.success(bookService.updateReadingProgress(bookId, request));
    }

    /**
     * 上传本地电子书文件到书架
     */
    @PostMapping("/upload")
    public ApiResponse<ShelfBookResponse> uploadBook(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "title", required = false) String title,
            @RequestParam(value = "author", required = false) String author,
            @RequestParam("shelfId") Long shelfId) throws Exception {

        ShelfBook sb = bookService.uploadBook(shelfId, file, title, author);
        ReadingProgress progress = bookService.getReadingProgress(sb.getBook().getId());

        // 计算未读页数
        int unreadPages = 0;
        if (progress.getTotalPages() > 0) {
            unreadPages = progress.getTotalPages() - progress.getCurrentPage();
        }

        ShelfBookResponse response = ShelfBookResponse.builder()
                .id(sb.getId())
                .bookId(sb.getBook().getId())
                .title(sb.getBook().getTitle())
                .author(sb.getBook().getAuthor())
                .coverUrl(sb.getBook().getCoverUrl())
                .extension(sb.getBook().getExtension())
                .filesize(sb.getBook().getFilesize())
                .unreadPages(unreadPages)
                .isFinished(progress.isFinished())
                .build();

        return ApiResponse.success(response);
    }

    /**
     * 获取书籍的目录结构（TOC）
     */
    @GetMapping("/{bookId}/toc")
    public ApiResponse<List<TocEntry>> getTableOfContents(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        // 无文件路径则返回空列表
        if (book.getFilePath() == null) {
            return ApiResponse.success(Collections.emptyList());
        }

        // 文件不存在则返回空列表
        Path filePath = Path.of(book.getFilePath());
        if (!filePath.toFile().exists()) {
            return ApiResponse.success(Collections.emptyList());
        }

        try {
            // 根据扩展名解析元数据，提取目录
            String extension = book.getExtension() != null ? "." + book.getExtension() : "";
            EbookMetadata meta = ebookParserService.parseFile(filePath, extension);
            return ApiResponse.success(meta.getToc() != null ? meta.getToc() : Collections.emptyList());
        } catch (Exception e) {
            return ApiResponse.success(Collections.emptyList());
        }
    }

    /**
     * 读取书籍文件并返回二进制内容（用于在线阅读器）。
     * 根据扩展名自动设置 Content-Type。
     */
    /** Serve uploaded/downloaded book files for reading */
    @GetMapping("/{bookId}/read")
    public ResponseEntity<?> readBook(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        // 无文件路径返回 404
        if (book.getFilePath() == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("No file available for this book"));
        }

        // 文件在磁盘上不存在返回 404
        Path filePath = Path.of(book.getFilePath());
        if (!filePath.toFile().exists()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("File not found on disk"));
        }

        try {
            byte[] bytes = Files.readAllBytes(filePath);
            // 根据扩展名确定 MIME 类型
            String contentType = "application/octet-stream";
            if (book.getExtension() != null) {
                contentType = switch (book.getExtension().toLowerCase()) {
                    case "pdf" -> "application/pdf";
                    case "epub" -> "application/epub+zip";
                    case "mobi" -> "application/x-mobipocket-ebook";
                    case "txt" -> "text/plain;charset=UTF-8";
                    default -> "application/octet-stream";
                };
            }

            return ResponseEntity.ok()
                    .contentType(org.springframework.http.MediaType.parseMediaType(contentType))
                    .body(bytes);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("Read failed: " + e.getMessage()));
        }
    }

    /**
     * 以内联方式流式传输书籍文件（供 foliate-js 阅读器使用，非下载附件形式）。
     */
    /** Stream book file inline for the foliate-js reader (not as download attachment) */
    @GetMapping("/{bookId}/stream")
    public ResponseEntity<?> streamBook(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        if (book.getFilePath() == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("No file available for this book"));
        }

        Path filePath = Path.of(book.getFilePath());
        if (!filePath.toFile().exists()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("File not found on disk"));
        }

        try {
            byte[] bytes = Files.readAllBytes(filePath);
            String contentType = "application/octet-stream";
            String filename = filePath.getFileName().toString();
            // 根据扩展名确定 MIME 类型
            if (book.getExtension() != null) {
                contentType = switch (book.getExtension().toLowerCase()) {
                    case "pdf" -> "application/pdf";
                    case "epub" -> "application/epub+zip";
                    case "mobi" -> "application/x-mobipocket-ebook";
                    case "txt" -> "text/plain;charset=UTF-8";
                    default -> "application/octet-stream";
                };
            }

            // 使用 inline 方式（而非 attachment），浏览器内预览
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + filename + "\"")
                    .contentType(MediaType.parseMediaType(contentType))
                    .body(bytes);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("Stream failed: " + e.getMessage()));
        }
    }

    /**
     * 获取 PDF 文件的元数据（总页数、标题、作者等信息）。
     */
    /** PDF metadata endpoint — returns page count and document info */
    @GetMapping("/{bookId}/pdf/info")
    public ApiResponse<Map<String, Object>> getPdfInfo(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));
        // 仅处理 PDF 文件
        if (book.getFilePath() == null || !book.getFilePath().toLowerCase().endsWith(".pdf")) {
            return ApiResponse.error("Not a PDF file");
        }
        Path filePath = Path.of(book.getFilePath());
        if (!filePath.toFile().exists()) {
            return ApiResponse.error("File not found");
        }
        // 打开 PDF 文档读取信息
        try (PDDocument doc = Loader.loadPDF(filePath.toFile())) {
            Map<String, Object> info = new HashMap<>();
            info.put("totalPages", doc.getNumberOfPages());
            if (doc.getDocumentInformation() != null) {
                info.put("title", doc.getDocumentInformation().getTitle());
                info.put("author", doc.getDocumentInformation().getAuthor());
            }
            return ApiResponse.success(info);
        } catch (Exception e) {
            return ApiResponse.error("Failed: " + e.getMessage());
        }
    }

    /**
     * 将 PDF 的单页渲染为 PNG 图片返回（支持自定义 DPI）。
     */
    /** Render a single PDF page as PNG */
    @GetMapping("/{bookId}/pdf/page/{pageNum}")
    public ResponseEntity<?> getPdfPage(@PathVariable Long bookId,
                                         @PathVariable int pageNum,
                                         @RequestParam(defaultValue = "144") int dpi) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));
        if (book.getFilePath() == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("No file");
        }
        Path filePath = Path.of(book.getFilePath());
        try (PDDocument doc = Loader.loadPDF(filePath.toFile())) {
            // 页码校验
            if (pageNum < 1 || pageNum > doc.getNumberOfPages()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Page out of range");
            }
            PDFRenderer renderer = new PDFRenderer(doc);
            // 渲染指定页面为图片（0-based 索引）
            BufferedImage image = renderer.renderImageWithDPI(pageNum - 1, dpi);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(image, "PNG", baos);
            byte[] bytes = baos.toByteArray();
            return ResponseEntity.ok()
                    .contentType(MediaType.IMAGE_PNG)
                    // 前 10 页缓存更久（封面等常用页）
                    .header(HttpHeaders.CACHE_CONTROL, "max-age=" + (pageNum <= 10 ? 86400 : 3600))
                    .body(bytes);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Render failed: " + e.getMessage());
        }
    }
}
