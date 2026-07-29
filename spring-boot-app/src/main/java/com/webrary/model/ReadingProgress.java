package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/**
 * 阅读进度实体，对应数据库中 reading_progress 表，记录每本书的阅读进度。
 */
@Entity
@Table(name = "reading_progress")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ReadingProgress {

    /** 主键ID，自动生成 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 关联的书籍（一对一） */
    @OneToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "book_id", nullable = false, unique = true)
    private Book book;

    /** 当前阅读到的页码 */
    @Column(name = "current_page")
    private int currentPage;

    /** 书籍总页数 */
    @Column(name = "total_pages")
    private int totalPages;

    /** 是否已读完整本书 */
    @Column(name = "is_finished")
    private boolean finished;

    /** 最近一次阅读时间 */
    @Column(name = "last_read_at")
    private LocalDateTime lastReadAt;
}
