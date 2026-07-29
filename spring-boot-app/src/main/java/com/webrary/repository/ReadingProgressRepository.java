package com.webrary.repository;

import com.webrary.model.Book;
import com.webrary.model.ReadingProgress;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 阅读进度数据访问层，提供阅读进度相关的数据库查询操作。
 */
public interface ReadingProgressRepository extends JpaRepository<ReadingProgress, Long> {
    /**
     * 根据书籍查找对应的阅读进度
     *
     * @param book 书籍实体
     * @return 匹配的阅读进度（可能为空）
     */
    Optional<ReadingProgress> findByBook(Book book);

    /**
     * 查询有最近阅读记录的所有进度，按最近阅读时间降序排列
     *
     * @return 按 lastReadAt 降序排列的阅读进度列表（用于阅读历史展示）
     */
    List<ReadingProgress> findByLastReadAtIsNotNullOrderByLastReadAtDesc();
}
