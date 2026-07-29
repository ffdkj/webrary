package com.webrary.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 静态资源配置 — 将本地上传目录映射为 /uploads/** URL 路径，供前端访问上传的书本文件。
 */
@Configuration
public class StaticResourceConfig implements WebMvcConfigurer {

    // 上传文件的存储目录，默认 ./data/uploads
    @Value("${webrary.upload-dir:./data/uploads}")
    private String uploadDir;

    /**
     * 注册资源处理器，将本地 uploadDir 映射到 /uploads/** URL。
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // 获取上传目录的绝对路径
        Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
        registry.addResourceHandler("/uploads/**")
                .addResourceLocations("file:" + uploadPath.toString() + "/");
    }
}
