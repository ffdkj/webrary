package com.webrary.service;

import com.webrary.dto.ShelfStats;
import com.webrary.model.Bookshelf;
import com.webrary.model.ReadingProgress;
import com.webrary.model.ShelfBook;
import com.webrary.repository.BookshelfRepository;
import com.webrary.repository.ReadingProgressRepository;
import com.webrary.repository.ShelfBookRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 书架管理服务 — 管理书架的创建、更新、删除、排序和统计。
 */
@Service
@RequiredArgsConstructor
public class BookshelfService {

    private final BookshelfRepository bookshelfRepository;
    private final ShelfBookRepository shelfBookRepository;
    private final ReadingProgressRepository readingProgressRepository;

    /**
     * 应用启动后初始化：如果没有任何书架，自动创建"默认书架"。
     */
    @PostConstruct
    public void init() {
        // Create default shelf if none exist
        if (bookshelfRepository.count() == 0) {
            Bookshelf defaultShelf = Bookshelf.builder()
                    .name("默认书架")
                    .sortOrder(0)
                    .build();
            bookshelfRepository.save(defaultShelf);
        }
    }

    /**
     * 获取所有书架列表（按排序顺序），并填充每架的书籍数量。
     */
    public List<Bookshelf> listAll() {
        List<Bookshelf> shelves = bookshelfRepository.findAllByOrderBySortOrderAsc();
        // 计算每个书架的书籍数量
        for (Bookshelf shelf : shelves) {
            shelf.setBookCount(shelfBookRepository.countByShelf(shelf));
        }
        return shelves;
    }

    /**
     * 创建新书架 — 自动分配排序号（当前最大排序号 + 1）。
     */
    @Transactional
    public Bookshelf create(String name) {
        // 计算当前最大排序号，新书架排在最末
        int maxOrder = bookshelfRepository.findAllByOrderBySortOrderAsc()
                .stream()
                .mapToInt(Bookshelf::getSortOrder)
                .max()
                .orElse(0);

        Bookshelf shelf = Bookshelf.builder()
                .name(name)
                .sortOrder(maxOrder + 1)
                .build();
        return bookshelfRepository.save(shelf);
    }

    /**
     * 更新书架名称。
     */
    @Transactional
    public Bookshelf update(Long id, String name) {
        Bookshelf shelf = bookshelfRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + id));
        shelf.setName(name);
        return bookshelfRepository.save(shelf);
    }

    /**
     * 删除书架（同时删除所有书架-书关联，但不删除 Book 实体本身）。
     */
    @Transactional
    public void delete(Long id) {
        Bookshelf shelf = bookshelfRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + id));

        // 删除该书架下的所有关联记录（不删除 Book 记录）
        // Remove all ShelfBook entries for this shelf (doesn't delete Book records)
        List<ShelfBook> shelfBooks = shelfBookRepository.findByShelfOrderByAddedAtDesc(shelf);
        shelfBookRepository.deleteAll(shelfBooks);

        bookshelfRepository.delete(shelf);
    }

    /**
     * 重新排序书架（前端拖拽排序后提交新的 ID 顺序）。
     */
    @Transactional
    public void reorder(List<Long> shelfIds) {
        // 按提交的顺序依次分配排序号
        for (int i = 0; i < shelfIds.size(); i++) {
            final int sortOrder = i;
            final Long shelfId = shelfIds.get(i);
            Bookshelf shelf = bookshelfRepository.findById(shelfId)
                    .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));
            shelf.setSortOrder(sortOrder);
            bookshelfRepository.save(shelf);
        }
    }

    /**
     * 获取书架统计信息：书本总数、未读数、已读数。
     */
    public ShelfStats getStats(Long shelfId) {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));

        List<ShelfBook> shelfBooks = shelfBookRepository.findByShelfOrderByAddedAtDesc(shelf);

        int bookCount = shelfBooks.size();
        int finishedCount = 0;
        int unreadCount = 0;

        // 遍历统计每本书的阅读状态
        for (ShelfBook sb : shelfBooks) {
            ReadingProgress progress = readingProgressRepository.findByBook(sb.getBook()).orElse(null);
            if (progress != null && progress.isFinished()) {
                finishedCount++;
            } else if (progress == null || progress.getCurrentPage() == 0) {
                unreadCount++;
            }
        }

        return ShelfStats.builder()
                .bookCount(bookCount)
                .unreadCount(unreadCount)
                .finishedCount(finishedCount)
                .build();
    }
}
