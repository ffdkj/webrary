# --- Build stage ---
FROM maven:3.9-eclipse-temurin-17-alpine AS build

WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline -q 2>/dev/null

COPY src/ src/
RUN mvn package -DskipTests -q

# --- Runtime stage ---
FROM eclipse-temurin:17-jre-jammy

RUN apt-get update && \
    apt-get install -y --no-install-recommends calibre && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /build/target/*.jar app.jar

RUN mkdir -p /app/data/uploads

VOLUME ["/app/data"]

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
