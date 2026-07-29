package com.webrary.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 认证拦截器 — 对 /api/** 请求进行登录验证，放行认证接口和静态资源。
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                             Object handler) throws Exception {
        String path = request.getRequestURI();

        // 放行认证相关接口（注册、登录、登出等）
        // Allow auth endpoints
        if (path.startsWith("/api/auth/")) {
            return true;
        }

        // 放行非 API 路径（静态资源、页面等）
        // Allow static resources
        if (!path.startsWith("/api/")) {
            return true;
        }

        // 检查会话，确认用户已登录
        // Check session
        HttpSession session = request.getSession(false);
        if (session != null && session.getAttribute("userId") != null) {
            return true;
        }

        // 未登录则返回 401 错误响应
        response.setStatus(401);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"success\":false,\"message\":\"请先登录\",\"data\":null}");
        return false;
    }
}
