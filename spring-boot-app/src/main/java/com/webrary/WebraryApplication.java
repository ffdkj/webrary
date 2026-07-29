package com.webrary;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Webrary 个人数字图书馆 — Spring Boot 应用主入口。
 */
@SpringBootApplication
public class WebraryApplication {
    /**
     * 应用程序启动方法
     */
    public static void main(String[] args) {
        SpringApplication.run(WebraryApplication.class, args);
    }
}
