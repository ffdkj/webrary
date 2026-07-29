package com.webrary.repository;

import com.webrary.model.Book;
import com.webrary.model.Bookshelf;
import com.webrary.model.ShelfBook;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

/**
 * 书架-书籍关联数据访问层，提供书架与书籍关系相关的数据库查询操作。
 */
public interface ShelfBookRepository extends JpaRepository<ShelfBook, Long> {
    /**
     * 查询某书架中所有书籍，按添加时间降序排列
     *
     * @param shelf 书架实体
     * @return 书架内的书籍关联列表
     */
    List<ShelfBook> findByShelfOrderByAddedAtDesc(Bookshelf shelf);

    /**
     * 查询某书架中特定的某本书
     *
     * @param shelf 书架实体
     * @param book  书籍实体
     * @return 匹配的书架-书籍关联记录（可能为空）
     */
    Optional<ShelfBook> findByShelfAndBook(Bookshelf shelf, Book book);

    /**
     * 统计某书架中的书籍数量
     *
     * @param shelf 书架实体
     * @return 书架中书籍的总数
     */
    int countByShelf(Bookshelf shelf);

    /**
     * 判断某书架上是否存在某本书
     *
     * @param shelf 书架实体
     * @param book  书籍实体
     * @return 是否存在
     */
    boolean existsByShelfAndBook(Bookshelf shelf, Book book);

    /**
     * 从书架上删除指定书籍（自定义JPQL，自动清除持久化上下文并刷新）
     *
     * @param shelf 书架实体
     * @param book  书籍实体
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM ShelfBook sb WHERE sb.shelf = :shelf AND sb.book = :book")
    void deleteByShelfAndBook(Bookshelf shelf, Book book);

    /**
     * 查找某本书出现在哪些书架上
     *
     * @param book 书籍实体
     * @return 该书在所有书架上的关联记录列表
     */
    List<ShelfBook> findByBook(Book book);
}
