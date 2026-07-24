package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "books")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Book {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "zlib_id")
    private Long zlibId;

    @Column(name = "zlib_hash")
    private String zlibHash;

    @Column(nullable = false)
    private String title;

    private String author;

    @Column(name = "cover_url", length = 2048)
    private String coverUrl;

    private String extension;

    private Long filesize;

    @Column(name = "file_path", length = 1024)
    private String filePath;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "is_uploaded")
    private boolean uploaded;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
