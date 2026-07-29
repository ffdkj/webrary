package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/**
 * 书架-书籍关联实体，对应数据库中 shelf_books 表，表示某本书属于某个书架的多对多关系。
 * 约束：同一书架上同一本书只能存在一条记录。
 */
@Entity
@Table(name = "shelf_books", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"shelf_id", "book_id"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShelfBook {

    /** 主键ID，自动生成 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 所属书架（懒加载） */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shelf_id", nullable = false)
    private Bookshelf shelf;

    /** 关联的书籍（立即加载） */
    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "book_id", nullable = false)
    private Book book;

    /** 书籍添加到书架的时间 */
    @Column(name = "added_at", nullable = false)
    private LocalDateTime addedAt;

    /** 实体持久化前自动填充添加时间 */
    @PrePersist
    protected void onCreate() {
        if (addedAt == null) {
            addedAt = LocalDateTime.now();
        }
    }
}
