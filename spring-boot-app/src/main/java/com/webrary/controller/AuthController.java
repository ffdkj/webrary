package com.webrary.controller;

import com.webrary.dto.ApiResponse;
import com.webrary.dto.AuthRequest;
import com.webrary.dto.UserResponse;
import com.webrary.service.AuthService;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * 用户认证控制器 — 处理注册、登录、登出、获取当前用户等认证相关请求。
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /**
     * 用户注册接口
     */
    @PostMapping("/register")
    public ApiResponse<UserResponse> register(@RequestBody AuthRequest request, HttpSession session) {
        try {
            UserResponse user = authService.register(request, session);
            return ApiResponse.success("注册成功", user);
        } catch (IllegalArgumentException e) {
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 用户登录接口
     */
    @PostMapping("/login")
    public ApiResponse<UserResponse> login(@RequestBody AuthRequest request, HttpSession session) {
        try {
            UserResponse user = authService.login(request, session);
            return ApiResponse.success("登录成功", user);
        } catch (IllegalArgumentException e) {
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 用户登出接口
     */
    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpSession session) {
        authService.logout(session);
        return ApiResponse.success("已登出", null);
    }

    /**
     * 获取当前登录用户信息
     */
    @GetMapping("/me")
    public ApiResponse<UserResponse> me(HttpSession session) {
        UserResponse user = authService.getCurrentUser(session);
        if (user == null) {
            return ApiResponse.error("未登录");
        }
        return ApiResponse.success(user);
    }
}
