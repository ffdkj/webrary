package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 添加书籍请求DTO，包含书籍的全部元信息。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BookAddRequest {
    /** Z-Library 书籍ID */
    private Long zlibId;
    /** Z-Library 书籍哈希值 */
    private String zlibHash;
    /** 书籍标题 */
    private String title;
    /** 作者 */
    private String author;
    /** 封面图片URL */
    private String coverUrl;
    /** 文件扩展名（如 epub、pdf） */
    private String extension;
    /** 文件大小（字节） */
    private Long filesize;
    /** 书籍描述/简介 */
    private String description;
    /** 本地文件路径 */
    private String filePath;
    /** 是否已上传 */
    private boolean uploaded;
}
