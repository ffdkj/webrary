package com.webrary.service;

import com.webrary.dto.BookAddRequest;
import com.webrary.dto.EbookMetadata;
import com.webrary.dto.HistoryEntry;
import com.webrary.dto.ReadingProgressRequest;
import com.webrary.dto.ShelfBookResponse;
import com.webrary.model.Book;
import com.webrary.model.Bookshelf;
import com.webrary.model.ReadingProgress;
import com.webrary.model.ShelfBook;
import com.webrary.repository.BookRepository;
import com.webrary.repository.BookshelfRepository;
import com.webrary.repository.ReadingProgressRepository;
import com.webrary.repository.ShelfBookRepository;
import com.webrary.repository.ShelfBookRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 书籍服务 — 管理书籍的增删改查、书架关联、上传、阅读进度等功能。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class BookService {

    private final BookRepository bookRepository;
    private final BookshelfRepository bookshelfRepository;
    private final ShelfBookRepository shelfBookRepository;
    private final ReadingProgressRepository readingProgressRepository;
    private final EbookParserService ebookParserService;

    // 上传文件存储目录
    @Value("${webrary.upload-dir:./data/uploads}")
    private String uploadDir;

    /**
     * 获取指定书架中的所有书籍（含阅读进度信息）。
     */
    /**
     * Get all books in a shelf with reading progress info.
     */
    public List<ShelfBookResponse> getBooksByShelf(Long shelfId) {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));

        // 按添加时间降序获取书架中的书籍
        List<ShelfBook> shelfBooks = shelfBookRepository.findByShelfOrderByAddedAtDesc(shelf);
        List<ShelfBookResponse> responses = new ArrayList<>();

        // 遍历每本书，计算未读页数
        for (ShelfBook sb : shelfBooks) {
            Book book = sb.getBook();
            ReadingProgress progress = readingProgressRepository.findByBook(book).orElse(null);

            int unreadPages = 0;
            if (progress != null && progress.getTotalPages() > 0) {
                unreadPages = progress.getTotalPages() - progress.getCurrentPage();
            }

            responses.add(ShelfBookResponse.builder()
                    .id(sb.getId())
                    .bookId(book.getId())
                    .title(book.getTitle())
                    .author(book.getAuthor())
                    .coverUrl(book.getCoverUrl())
                    .extension(book.getExtension())
                    .filesize(book.getFilesize())
                    .unreadPages(unreadPages)
                    .isFinished(progress != null && progress.isFinished())
                    .filePath(book.getFilePath())
                    .zlibId(book.getZlibId())
                    .zlibHash(book.getZlibHash())
                    .build());
        }

        return responses;
    }

    /**
     * 向书架添加书籍。如果书籍记录不存在（按 zlibId 查找），则创建新的 Book 记录。
     */
    /**
     * Add a book to a shelf. Creates the Book record if it doesn't exist by zlibId.
     */
    @Transactional
    public ShelfBook addBookToShelf(Long shelfId, BookAddRequest request) {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));

        // 如果提供了 zlibId，先查找是否已有此书
        Book book;
        if (request.getZlibId() != null) {
            Optional<Book> existing = bookRepository.findByZlibId(request.getZlibId());
            if (existing.isPresent()) {
                book = existing.get();
            } else {
                // 创建新的 Z-Library 来源书籍记录
                book = Book.builder()
                        .zlibId(request.getZlibId())
                        .zlibHash(request.getZlibHash() != null ? request.getZlibHash() : "")
                        .title(request.getTitle())
                        .author(request.getAuthor())
                        .coverUrl(request.getCoverUrl())
                        .extension(request.getExtension())
                        .filesize(request.getFilesize())
                        .description(request.getDescription())
                        .uploaded(false)
                        .build();
                book = bookRepository.save(book);
            }
        } else {
            // 创建本地上传的书籍记录
            book = Book.builder()
                    .title(request.getTitle())
                    .author(request.getAuthor())
                    .coverUrl(request.getCoverUrl())
                    .extension(request.getExtension())
                    .filesize(request.getFilesize())
                    .description(request.getDescription())
                    .uploaded(true)
                    .build();
            book = bookRepository.save(book);
        }

        // 检查是否已在该书架中，避免重复添加
        // Check if already in this shelf
        if (shelfBookRepository.existsByShelfAndBook(shelf, book)) {
            return shelfBookRepository.findByShelfAndBook(shelf, book).orElse(null);
        }

        // 创建书架与书的关联记录
        ShelfBook shelfBook = ShelfBook.builder()
                .shelf(shelf)
                .book(book)
                .build();

        return shelfBookRepository.save(shelfBook);
    }

    /**
     * 从书架中移除书籍（不删除 Book 实体本身）。
     */
    /**
     * Remove a book from a shelf (doesn't delete Book record).
     */
    @Transactional
    public void removeBookFromShelf(Long shelfId, Long bookId) {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        shelfBookRepository.deleteByShelfAndBook(shelf, book);
    }

    /**
     * 将书籍从一个书架转移到另一个书架。
     * 如果目标书架已有此书，则仅从源书架移除。
     */
    /**
     * Transfer a book from one shelf to another.
     * If the book is already in the target shelf, just remove from source.
     */
    @Transactional
    public void transferBook(Long fromShelfId, Long toShelfId, Long bookId) {
        Bookshelf fromShelf = bookshelfRepository.findById(fromShelfId)
                .orElseThrow(() -> new RuntimeException("Source shelf not found: " + fromShelfId));
        Bookshelf toShelf = bookshelfRepository.findById(toShelfId)
                .orElseThrow(() -> new RuntimeException("Target shelf not found: " + toShelfId));
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        // 从源书架移除
        // Remove from source
        shelfBookRepository.deleteByShelfAndBook(fromShelf, book);

        // 如果目标书架没有此书，则添加
        // Add to target if not already there
        if (!shelfBookRepository.existsByShelfAndBook(toShelf, book)) {
            ShelfBook shelfBook = ShelfBook.builder()
                    .shelf(toShelf)
                    .book(book)
                    .build();
            shelfBookRepository.save(shelfBook);
        }
    }

    /**
     * 彻底删除书籍：从所有书架移除、删除阅读进度、删除上传文件、删除数据库记录。
     */
    /**
     * Delete a book entirely from all shelves and the database.
     */
    @Transactional
    public void deleteBook(Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        // 从所有书架中移除该书的关联
        // Remove from all shelves
        List<ShelfBook> entries = shelfBookRepository.findByBook(book);
        shelfBookRepository.deleteAll(entries);

        // 删除阅读进度记录
        // Remove reading progress
        readingProgressRepository.findByBook(book).ifPresent(readingProgressRepository::delete);

        // 删除磁盘上的上传文件
        // Delete uploaded file if exists
        if (book.isUploaded() && book.getFilePath() != null) {
            try {
                Files.deleteIfExists(Path.of(book.getFilePath()));
            } catch (IOException ignored) {
            }
        }

        bookRepository.delete(book);
    }

    /**
     * 上传电子书文件到指定书架。
     * 自动解析元数据（标题、作者、封面、页数），保存封面图片并初始化阅读进度。
     */
    /**
     * Upload a book file.
     */
    @Transactional
    public ShelfBook uploadBook(Long shelfId, MultipartFile file, String title, String author) throws IOException {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));

        // 确保上传目录存在（使用绝对路径）
        // Ensure upload directory exists (use absolute path from working dir)
        Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
        if (!Files.exists(uploadPath)) {
            Files.createDirectories(uploadPath);
        }

        // 生成唯一文件名
        // Generate unique filename
        String originalFilename = file.getOriginalFilename();
        String extension = "";
        if (originalFilename != null && originalFilename.contains(".")) {
            extension = originalFilename.substring(originalFilename.lastIndexOf("."));
        }
        String storedFilename = UUID.randomUUID().toString() + extension;
        Path filePath = uploadPath.resolve(storedFilename);

        // 保存文件到磁盘
        // Save file
        file.transferTo(filePath.toFile());

        // 解析电子书元数据（标题、作者）
        // Parse ebook metadata
        try {
            EbookMetadata meta = ebookParserService.parseFile(filePath, extension);
            if (meta.getTitle() != null && title == null) {
                title = meta.getTitle();
            }
            if (meta.getAuthor() != null && author == null) {
                author = meta.getAuthor();
            }
        } catch (Exception e) {
            log.warn("Failed to parse ebook: {}", e.getMessage());
        }

        // 创建书籍记录
        // Create book record
        Book book = Book.builder()
                .title(title != null ? title : originalFilename)
                .author(author)
                .extension(extension.replace(".", ""))
                .filesize(file.getSize())
                .filePath(filePath.toString())
                .uploaded(true)
                .build();
        book = bookRepository.save(book);

        // 保存封面图片并从元数据更新阅读进度
        // Save cover image and update reading progress from parsed metadata
        try {
            EbookMetadata meta = ebookParserService.parseFile(filePath, extension);
            // 保存封面图片
            if (meta.getCoverBytes() != null && meta.getCoverBytes().length > 0) {
                String coverFilename = storedFilename.replace(extension, "_cover"
                        + (meta.getCoverFormat() != null ? "." + meta.getCoverFormat() : ".jpg"));
                Path coverPath = uploadPath.resolve(coverFilename);
                Files.write(coverPath, meta.getCoverBytes());
                book.setCoverUrl("/uploads/" + coverFilename);
                book = bookRepository.save(book);
            }
            // 如果解析到了页数，更新阅读进度
            if (meta.getPages() != null && meta.getPages() > 0) {
                ReadingProgress progress = readingProgressRepository.findByBook(book).orElse(null);
                if (progress == null) {
                    progress = ReadingProgress.builder().book(book).build();
                }
                progress.setTotalPages(meta.getPages());
                readingProgressRepository.save(progress);
            }
        } catch (Exception e) {
            log.warn("Failed to save parsed ebook metadata: {}", e.getMessage());
        }

        // 添加到书架
        // Add to shelf
        ShelfBook shelfBook = ShelfBook.builder()
                .shelf(shelf)
                .book(book)
                .build();

        return shelfBookRepository.save(shelfBook);
    }

    /**
     * 获取书籍的阅读进度（无记录时创建默认进度）。
     */
    /**
     * Get reading progress for a book (creates default if not found).
     */
    public ReadingProgress getReadingProgress(Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));
        return readingProgressRepository.findByBook(book)
                .orElseGet(() -> {
                    // 无记录时创建默认阅读进度
                    ReadingProgress progress = ReadingProgress.builder()
                            .book(book)
                            .currentPage(0)
                            .totalPages(0)
                            .finished(false)
                            .build();
                    return readingProgressRepository.save(progress);
                });
    }

    /**
     * 更新书籍的阅读进度。
     */
    /**
     * Update reading progress for a book.
     */
    @Transactional
    public ReadingProgress updateReadingProgress(Long bookId, ReadingProgressRequest request) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        // 查找或创建阅读进度记录
        ReadingProgress progress = readingProgressRepository.findByBook(book)
                .orElseGet(() -> ReadingProgress.builder()
                        .book(book)
                        .currentPage(0)
                        .totalPages(0)
                        .finished(false)
                        .build());

        // 更新进度字段
        progress.setCurrentPage(request.getCurrentPage());
        if (request.getTotalPages() > 0) {
            progress.setTotalPages(request.getTotalPages());
        }
        progress.setFinished(request.isFinished());
        progress.setLastReadAt(LocalDateTime.now());

        return readingProgressRepository.save(progress);
    }

    /**
     * 获取阅读历史 — 所有有阅读记录的书籍，按最近阅读时间降序排列。
     */
    /**
     * Get reading history — all books that have been read, ordered by most recent first.
     */
    public List<HistoryEntry> getReadingHistory() {
        // 查询所有有阅读时间记录的进度，按时间倒序
        List<ReadingProgress> progresses = readingProgressRepository.findByLastReadAtIsNotNullOrderByLastReadAtDesc();
        List<HistoryEntry> entries = new ArrayList<>();
        for (ReadingProgress p : progresses) {
            Book b = p.getBook();
            entries.add(HistoryEntry.builder()
                    .bookId(b.getId())
                    .title(b.getTitle())
                    .author(b.getAuthor())
                    .coverUrl(b.getCoverUrl())
                    .extension(b.getExtension())
                    .lastReadAt(p.getLastReadAt())
                    .build());
        }
        return entries;
    }
}
