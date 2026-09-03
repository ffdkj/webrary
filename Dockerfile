FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt requirements-agent.txt .
RUN pip install --no-cache-dir -r requirements.txt -r requirements-agent.txt

COPY app ./app
COPY static ./static
COPY start.sh ./start.sh
RUN chmod +x ./start.sh && mkdir -p /app/data

EXPOSE 8000

CMD ["./start.sh"]
