package com.webrary.service;

import com.webrary.dto.AuthRequest;
import com.webrary.dto.UserResponse;
import com.webrary.model.User;
import com.webrary.model.UserZlibrary;
import com.webrary.repository.UserRepository;
import com.webrary.repository.UserZlibraryRepository;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class AuthService {

    private static final String SESSION_USER_ID = "userId";

    private final UserRepository userRepository;
    private final UserZlibraryRepository userZlibraryRepository;

    @Transactional
    public UserResponse register(AuthRequest request, HttpSession session) {
        if (request.getEmail() == null || request.getEmail().isBlank()
                || request.getPassword() == null || request.getPassword().isBlank()) {
            throw new IllegalArgumentException("邮箱和密码不能为空");
        }
        if (userRepository.existsByEmail(request.getEmail().trim())) {
            throw new IllegalArgumentException("该邮箱已注册");
        }

        String salt = generateSalt();
        String hash = hashPassword(request.getPassword(), salt);

        User user = User.builder()
                .email(request.getEmail().trim())
                .passwordHash(salt + ":" + hash)
                .build();
        user = userRepository.save(user);

        session.setAttribute(SESSION_USER_ID, user.getId());
        return buildUserResponse(user);
    }

    public UserResponse login(AuthRequest request, HttpSession session) {
        User user = userRepository.findByEmail(request.getEmail().trim())
                .orElseThrow(() -> new IllegalArgumentException("邮箱或密码错误"));

        String[] parts = user.getPasswordHash().split(":", 2);
        if (parts.length != 2 || !hashPassword(request.getPassword(), parts[0]).equals(parts[1])) {
            throw new IllegalArgumentException("邮箱或密码错误");
        }

        session.setAttribute(SESSION_USER_ID, user.getId());
        return buildUserResponse(user);
    }

    public void logout(HttpSession session) {
        session.removeAttribute(SESSION_USER_ID);
        session.invalidate();
    }

    public UserResponse getCurrentUser(HttpSession session) {
        Long userId = (Long) session.getAttribute(SESSION_USER_ID);
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId)
                .map(this::buildUserResponse)
                .orElse(null);
    }

    public User getCurrentUserEntity(HttpSession session) {
        Long userId = (Long) session.getAttribute(SESSION_USER_ID);
        if (userId == null) return null;
        return userRepository.findById(userId).orElse(null);
    }

    private UserResponse buildUserResponse(User user) {
        Optional<UserZlibrary> zlib = userZlibraryRepository.findByUser(user);
        return UserResponse.builder()
                .id(user.getId())
                .email(user.getEmail())
                .zlibraryBound(zlib.isPresent() && zlib.get().getRemixUserkey() != null)
                .zlibraryEmail(zlib.map(UserZlibrary::getZlibraryEmail).orElse(null))
                .build();
    }

    private String generateSalt() {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }

    private String hashPassword(String password, String salt) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(salt.getBytes());
            byte[] hash = md.digest(password.getBytes());
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new RuntimeException("Hash error", e);
        }
    }
}
