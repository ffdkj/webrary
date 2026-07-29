package com.webrary.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/**
 * Z-Library配置实体，对应数据库中 zlibrary_config 表，以键值对形式存储Z-Library的相关配置项。
 */
@Entity
@Table(name = "zlibrary_config")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ZlibraryConfig {

    /** 主键ID，自动生成 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 配置键（唯一标识） */
    @Column(name = "config_key", nullable = false, unique = true)
    private String configKey;

    /** 配置值 */
    @Column(name = "config_value", length = 2048)
    private String configValue;

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
