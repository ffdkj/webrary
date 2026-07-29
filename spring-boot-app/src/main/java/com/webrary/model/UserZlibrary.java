package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/**
 * 用户-ZLibrary绑定实体，对应数据库中 user_zlibrary 表，存储用户绑定的Z-Library账号及代理配置。
 * 每个用户只能绑定一个Z-Library账号。
 */
@Entity
@Table(name = "user_zlibrary", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"user_id"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserZlibrary {

    /** 主键ID，自动生成 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 关联的本地用户（一对一，懒加载） */
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    /** Z-Library 登录邮箱 */
    @Column(name = "zlibrary_email")
    private String zlibraryEmail;

    /** Z-Library 登录密码 */
    @Column(name = "zlibrary_password")
    private String zlibraryPassword;

    /** Z-Library remixUserId，用于API认证 */
    @Column(name = "remix_userid")
    private String remixUserId;

    /** Z-Library remixUserkey，用于API认证 */
    @Column(name = "remix_userkey")
    private String remixUserkey;

    /** Z-Library 访问域名 */
    private String domain;

    /** 代理服务器主机地址 */
    @Column(name = "proxy_host")
    private String proxyHost;

    /** 代理服务器端口 */
    @Column(name = "proxy_port")
    private Integer proxyPort;

    /** 记录最后更新时间 */
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /** 实体持久化或更新前自动更新时间戳 */
    @PrePersist
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
