package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 书籍信息DTO，展示书籍的详细元数据。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BookInfo {
    /** 书籍ID */
    private Long id;
    /** 书名 */
    private String title;
    /** 作者 */
    private String author;
    /** 封面图片URL */
    private String cover;
    /** 文件扩展名 */
    private String extension;
    /** 文件大小（字节） */
    private Long filesize;
    /** 文件大小（可读字符串，如 "2.5 MB"） */
    private String filesizeString;
    /** 文件哈希值 */
    private String hash;
    /** 出版年份 */
    private Integer year;
    /** 语言 */
    private String language;
    /** 书籍描述 */
    private String description;
    /** 页数 */
    private Integer pages;
    /** 出版社 */
    private String publisher;
    /** 系列/丛书名 */
    private String series;
}
