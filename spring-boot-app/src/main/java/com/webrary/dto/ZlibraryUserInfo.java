package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Z-Library 用户信息DTO，展示Z-Library账号详情。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ZlibraryUserInfo {
    /** Z-Library 用户ID */
    private Long id;
    /** Z-Library 邮箱 */
    private String email;
    /** 用户名/昵称 */
    private String name;
    /** Kindle 推送邮箱 */
    private String kindleEmail;
    /** remixUserkey，用于Z-Library API认证 */
    private String remixUserkey;
    /** 今日已下载次数 */
    private int downloadsToday;
    /** 每日下载上限 */
    private int downloadsLimit;
    /** 账号是否已验证 */
    private boolean confirmed;
    /** 是否为高级会员 */
    private boolean isPremium;
}
