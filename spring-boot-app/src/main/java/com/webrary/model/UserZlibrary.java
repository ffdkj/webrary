package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "user_zlibrary", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"user_id"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserZlibrary {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    @Column(name = "zlibrary_email")
    private String zlibraryEmail;

    @Column(name = "zlibrary_password")
    private String zlibraryPassword;

    @Column(name = "remix_userid")
    private String remixUserId;

    @Column(name = "remix_userkey")
    private String remixUserkey;

    private String domain;

    @Column(name = "proxy_host")
    private String proxyHost;

    @Column(name = "proxy_port")
    private Integer proxyPort;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
