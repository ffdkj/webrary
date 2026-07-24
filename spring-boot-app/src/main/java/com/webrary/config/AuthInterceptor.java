package com.webrary.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                             Object handler) throws Exception {
        String path = request.getRequestURI();

        // Allow auth endpoints
        if (path.startsWith("/api/auth/")) {
            return true;
        }

        // Allow static resources
        if (!path.startsWith("/api/")) {
            return true;
        }

        // Check session
        HttpSession session = request.getSession(false);
        if (session != null && session.getAttribute("userId") != null) {
            return true;
        }

        response.setStatus(401);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"success\":false,\"message\":\"请先登录\",\"data\":null}");
        return false;
    }
}
