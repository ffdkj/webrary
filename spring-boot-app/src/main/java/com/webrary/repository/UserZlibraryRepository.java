package com.webrary.repository;

import com.webrary.model.User;
import com.webrary.model.UserZlibrary;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface UserZlibraryRepository extends JpaRepository<UserZlibrary, Long> {
    Optional<UserZlibrary> findByUser(User user);
    Optional<UserZlibrary> findByUserId(Long userId);
}
