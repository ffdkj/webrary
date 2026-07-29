package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 认证请求DTO，用于登录/注册时传递邮箱和密码。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuthRequest {
    /** 用户邮箱 */
    private String email;
    /** 用户密码 */
    private String password;
}
