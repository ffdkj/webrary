package com.webrary.controller;

import com.webrary.dto.ApiResponse;
import com.webrary.dto.AuthRequest;
import com.webrary.dto.UserResponse;
import com.webrary.service.AuthService;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/register")
    public ApiResponse<UserResponse> register(@RequestBody AuthRequest request, HttpSession session) {
        try {
            UserResponse user = authService.register(request, session);
            return ApiResponse.success("注册成功", user);
        } catch (IllegalArgumentException e) {
            return ApiResponse.error(e.getMessage());
        }
    }

    @PostMapping("/login")
    public ApiResponse<UserResponse> login(@RequestBody AuthRequest request, HttpSession session) {
        try {
            UserResponse user = authService.login(request, session);
            return ApiResponse.success("登录成功", user);
        } catch (IllegalArgumentException e) {
            return ApiResponse.error(e.getMessage());
        }
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpSession session) {
        authService.logout(session);
        return ApiResponse.success("已登出", null);
    }

    @GetMapping("/me")
    public ApiResponse<UserResponse> me(HttpSession session) {
        UserResponse user = authService.getCurrentUser(session);
        if (user == null) {
            return ApiResponse.error("未登录");
        }
        return ApiResponse.success(user);
    }
}
