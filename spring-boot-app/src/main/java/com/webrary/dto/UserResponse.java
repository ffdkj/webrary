package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户响应DTO，返回用户基本信息及其Z-Library绑定状态。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserResponse {
    /** 用户ID */
    private Long id;
    /** 用户邮箱 */
    private String email;
    /** 是否已绑定Z-Library账号 */
    private boolean zlibraryBound;
    /** 已绑定的Z-Library邮箱 */
    private String zlibraryEmail;
}
