package com.webrary.repository;

import com.webrary.model.ZlibraryConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

/**
 * Z-Library配置数据访问层，提供Z-Library配置相关的数据库查询操作。
 */
public interface ZlibraryConfigRepository extends JpaRepository<ZlibraryConfig, Long> {
    /**
     * 根据配置键查找配置项
     *
     * @param configKey 配置键名称
     * @return 匹配的配置记录（可能为空）
     */
    Optional<ZlibraryConfig> findByConfigKey(String configKey);
}
