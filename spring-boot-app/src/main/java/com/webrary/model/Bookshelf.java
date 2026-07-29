package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/**
 * 书架实体，对应数据库中 bookshelves 表，用于组织和管理书籍。
 */
@Entity
@Table(name = "bookshelves")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Bookshelf {

    /** 主键ID，自动生成 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 书架名称 */
    @Column(nullable = false)
    private String name;

    /** 排序序号，用于控制书架显示顺序 */
    @Column(name = "sort_order")
    private int sortOrder;

    /** 书架内书籍数量（数据库非持久化字段，内存计算用） */
    @Transient
    private int bookCount;

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
