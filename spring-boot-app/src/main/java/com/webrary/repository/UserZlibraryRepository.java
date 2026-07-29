package com.webrary.repository;

import com.webrary.model.User;
import com.webrary.model.UserZlibrary;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

/**
 * 用户-ZLibrary绑定数据访问层，提供Z-Library绑定相关的数据库查询操作。
 */
public interface UserZlibraryRepository extends JpaRepository<UserZlibrary, Long> {
    /**
     * 根据用户实体查找其Z-Library绑定记录
     *
     * @param user 用户实体
     * @return 匹配的绑定记录（可能为空）
     */
    Optional<UserZlibrary> findByUser(User user);

    /**
     * 根据用户ID查找其Z-Library绑定记录
     *
     * @param userId 用户ID
     * @return 匹配的绑定记录（可能为空）
     */
    Optional<UserZlibrary> findByUserId(Long userId);
}
