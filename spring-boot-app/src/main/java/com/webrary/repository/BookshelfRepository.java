package com.webrary.repository;

import com.webrary.model.Bookshelf;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

/**
 * 书架数据访问层，提供书架相关的数据库查询操作。
 */
public interface BookshelfRepository extends JpaRepository<Bookshelf, Long> {
    /**
     * 按排序序号升序查询所有书架
     *
     * @return 按 sortOrder 升序排列的书架列表
     */
    List<Bookshelf> findAllByOrderBySortOrderAsc();
}
