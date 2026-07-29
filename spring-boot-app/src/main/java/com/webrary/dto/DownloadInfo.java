package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 下载信息DTO，包含从Z-Library获取的下载链接及相关元数据。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DownloadInfo {
    /** 下载链接URL */
    private String downloadLink;
    /** 文件名 */
    private String filename;
    /** 书籍描述 */
    private String description;
    /** 作者 */
    private String author;
    /** 文件扩展名 */
    private String extension;
    /** 文件大小（字节） */
    private Long filesize;
}
