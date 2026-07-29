package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/**
 * 用户实体，对应数据库中 users 表，存储用户的认证信息。
 */
@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    /** 主键ID，自动生成 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 用户邮箱（唯一，用于登录） */
    @Column(nullable = false, unique = true)
    private String email;

    /** 密码哈希值 */
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    /** 账户创建时间 */
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /** 实体持久化前自动填充创建时间 */
    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
