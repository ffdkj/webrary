package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "reading_progress")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ReadingProgress {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "book_id", nullable = false, unique = true)
    private Book book;

    @Column(name = "current_page")
    private int currentPage;

    @Column(name = "total_pages")
    private int totalPages;

    @Column(name = "is_finished")
    private boolean finished;

    @Column(name = "last_read_at")
    private LocalDateTime lastReadAt;
}
