package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/**
 * 书籍实体，对应数据库中 books 表，存储书籍的元数据信息。
 */
@Entity
@Table(name = "books")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Book {

    /** 主键ID，自动生成 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Z-Library 书籍ID */
    @Column(name = "zlib_id")
    private Long zlibId;

    /** Z-Library 书籍哈希值 */
    @Column(name = "zlib_hash")
    private String zlibHash;

    /** 书名 */
    @Column(nullable = false)
    private String title;

    /** 作者 */
    private String author;

    /** 封面图片URL */
    @Column(name = "cover_url", length = 2048)
    private String coverUrl;

    /** 文件扩展名（如 epub、pdf） */
    private String extension;

    /** 文件大小（字节） */
    private Long filesize;

    /** 本地文件存储路径 */
    @Column(name = "file_path", length = 1024)
    private String filePath;

    /** 书籍描述/简介（长文本） */
    @Column(columnDefinition = "TEXT")
    private String description;

    /** 是否已上传到服务器 */
    @Column(name = "is_uploaded")
    private boolean uploaded;

    /** 记录创建时间 */
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
