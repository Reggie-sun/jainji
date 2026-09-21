.PHONY: frontend

frontend:
	@scripts/dev-stop.sh
	(env -u ELECTRON_RUN_AS_NODE npm run dev > /tmp/jianji-dev.log 2>&1 &)
	@sleep 3
	@echo "Jianji dev server started."
	@echo "Logs: tail -f /tmp/jianji-dev.log"
	@echo ""
	@tail -20 /tmp/jianji-dev.log
