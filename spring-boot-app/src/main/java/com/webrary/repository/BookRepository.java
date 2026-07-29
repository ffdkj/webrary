package com.webrary.repository;

import com.webrary.model.Book;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

/**
 * 书籍数据访问层，提供书籍相关的数据库查询操作。
 */
public interface BookRepository extends JpaRepository<Book, Long> {
    /**
     * 根据Z-Library书籍ID查找书籍
     *
     * @param zlibId Z-Library 书籍ID
     * @return 匹配的书籍（可能为空）
     */
    Optional<Book> findByZlibId(Long zlibId);
}
