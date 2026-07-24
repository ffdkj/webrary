package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ZlibraryUserInfo {
    private Long id;
    private String email;
    private String name;
    private String kindleEmail;
    private String remixUserkey;
    private int downloadsToday;
    private int downloadsLimit;
    private boolean confirmed;
    private boolean isPremium;
}
