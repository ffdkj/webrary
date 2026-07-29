package com.webrary.repository;

import com.webrary.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

/**
 * 用户数据访问层，提供用户相关的数据库查询操作。
 */
public interface UserRepository extends JpaRepository<User, Long> {
    /**
     * 根据邮箱查找用户
     *
     * @param email 用户邮箱
     * @return 匹配的用户（可能为空）
     */
    Optional<User> findByEmail(String email);

    /**
     * 判断指定邮箱是否已注册
     *
     * @param email 用户邮箱
     * @return 是否存在该邮箱的用户
     */
    boolean existsByEmail(String email);
}
