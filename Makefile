.PHONY: install run check

install:
	python -m pip install -r requirements.txt

run:
	uvicorn main:app --host 0.0.0.0 --port 8000 --reload

check:
	python -m py_compile main.py database.py models.py services/market_data.py
	python -c "from database import initialize_database; initialize_database(); print('SQLite schema initialized')"
