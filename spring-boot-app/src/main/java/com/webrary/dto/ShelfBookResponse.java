package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 书架上的书籍响应DTO，展示书架中某本书的完整信息（含阅读进度）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ShelfBookResponse {
    /** 书架-书籍关联记录ID */
    private Long id;
    /** 书籍ID */
    private Long bookId;
    /** 书名 */
    private String title;
    /** 作者 */
    private String author;
    /** 封面图片URL */
    private String coverUrl;
    /** 文件扩展名 */
    private String extension;
    /** 文件大小（字节） */
    private Long filesize;
    /** 剩余未读页数 */
    private Integer unreadPages;
    /** 是否已读完整本书 */
    private Boolean isFinished;
    /** 本地文件路径 */
    private String filePath;
    /** 在线阅读URL */
    private String readOnlineUrl;
    /** Z-Library 书籍ID */
    private Long zlibId;
    /** Z-Library 书籍哈希值 */
    private String zlibHash;
}
