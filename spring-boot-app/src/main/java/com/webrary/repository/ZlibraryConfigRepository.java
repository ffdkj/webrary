package com.webrary.repository;

import com.webrary.model.ZlibraryConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface ZlibraryConfigRepository extends JpaRepository<ZlibraryConfig, Long> {
    Optional<ZlibraryConfig> findByConfigKey(String configKey);
}
