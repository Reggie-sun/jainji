.PHONY: frontend

frontend:
	-pkill -9 -f "electron/dist/electron" 2>/dev/null; sleep 1
	(env -u ELECTRON_RUN_AS_NODE npm run dev > /tmp/jianji-dev.log 2>&1 &)
	@sleep 3
	@echo "Jianji dev server started. Logs: tail -f /tmp/jianji-dev.log"
