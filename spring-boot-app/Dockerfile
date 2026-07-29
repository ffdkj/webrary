# --- Build stage ---
FROM maven:3.9-eclipse-temurin-17-alpine AS build

WORKDIR /build
COPY pom.xml .
COPY src/ src/
RUN mvn package -DskipTests -q

# --- Runtime stage ---
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

COPY --from=build /build/target/*.jar app.jar
RUN mkdir -p /app/data/uploads

VOLUME ["/app/data"]

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
