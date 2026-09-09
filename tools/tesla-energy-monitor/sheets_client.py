"""Write the parsed snapshot to the SMC Google Sheet via a service account."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import google.auth
import gspread
from google.auth.exceptions import DefaultCredentialsError

from parse import GUIDE_TAB, HEADERS, HISTORY_TAB, LIVE_TAB, row_values

SHEETS_SCOPES = (
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
)

DEFAULT_SHEET_TITLES = {"Sheet1", "工作表1", "sheet1"}

GUIDE_ROWS = [
    ["SMC Tesla 能源動態監測 — 使用說明"],
    [""],
    ["這張表由電腦上的小工具自動更新，不是公開網站。請不要把 Tesla 或 Google 金鑰貼進任何分頁。"],
    [""],
    ["分頁"],
    ["即時現況", "每次執行覆寫成一列表頭 + 一列目前數值（Asia/Taipei）。"],
    ["歷史紀錄", "每次執行在表頭下方插入一列，最新在最上面。"],
    ["說明", "本頁。工具只在空白時寫入，之後不會覆蓋你手寫的備註。"],
    [""],
    ["怎麼跑（水美總管）"],
    ["1. 在操作電腦安裝 Python 3.10+，於 tools/tesla-energy-monitor 執行: pip install -r requirements.txt"],
    ["2. 複製 env.example 成 .env，填入 Tesla 與 Google 路徑（不要把 .env 傳到 GitHub）。"],
    ["3. Google：開 Sheets API、建服務帳戶、下載 JSON 金鑰、用該 email 把本表設為「編輯者」。"],
    ["4. 試跑: python3 update.py --dry-run    （只印列，不寫入）"],
    ["5. 正式: python3 update.py --quiet"],
    [""],
    ["建議頻率"],
    ["每 5–15 分鐘一次即可。每次只打一筆 Tesla live_status。不要每秒跑，以免觸及 Fleet API 速率限制與計費。"],
    [""],
    ["試算表"],
    ["https://docs.google.com/spreadsheets/d/1wYslB5UNTLc_Cy3DsdD4Zly9ZmDDY_8qu3UfVvvm0WA/edit"],
    [""],
    ["完整說明請看 repo 裡的 tools/tesla-energy-monitor/README.md"],
]


class SheetsError(RuntimeError):
    """Google auth or spreadsheet write failed."""


def _authorize() -> gspread.Client:
    try:
        creds, _ = google.auth.default(scopes=list(SHEETS_SCOPES))
    except DefaultCredentialsError as exc:
        raise SheetsError(
            "Google credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS "
            "to the service-account JSON path, or run "
            "`gcloud auth application-default login` for local testing."
        ) from exc
    return gspread.authorize(creds)


def _worksheet_or_create(spreadsheet: gspread.Spreadsheet, title: str, rows: int, cols: int):
    try:
        return spreadsheet.worksheet(title)
    except gspread.exceptions.WorksheetNotFound:
        existing = spreadsheet.worksheets()
        if (
            len(existing) == 1
            and existing[0].title in DEFAULT_SHEET_TITLES
            and not existing[0].get_all_values()
        ):
            existing[0].update_title(title)
            return existing[0]
        return spreadsheet.add_worksheet(title=title, rows=rows, cols=cols)


def _is_blank(ws: gspread.Worksheet) -> bool:
    values = ws.get_all_values()
    return not any(cell.strip() for row in values for cell in row if cell is not None)


def _headers_match(ws: gspread.Worksheet) -> bool:
    first = ws.row_values(1)
    return first[: len(HEADERS)] == HEADERS


def write_snapshot(sheet_id: str, row: Mapping[str, Any]) -> None:
    if not sheet_id:
        raise SheetsError("Sheet id is empty.")

    try:
        client = _authorize()
        spreadsheet = client.open_by_key(sheet_id)
    except gspread.exceptions.APIError as exc:
        raise SheetsError(
            "Could not open the Google Sheet. Confirm the service account "
            "email has Editor access, and that Sheets API is enabled."
        ) from exc
    except gspread.exceptions.SpreadsheetNotFound as exc:
        raise SheetsError(
            "Spreadsheet not found for this id. Share it with the service account."
        ) from exc
    except PermissionError as exc:
        raise SheetsError(str(exc)) from exc

    values: Sequence[Any] = row_values(row)
    live = _worksheet_or_create(spreadsheet, LIVE_TAB, rows=20, cols=12)
    history = _worksheet_or_create(spreadsheet, HISTORY_TAB, rows=2000, cols=12)
    guide = _worksheet_or_create(spreadsheet, GUIDE_TAB, rows=40, cols=4)

    live.update(range_name="A1:I2", values=[HEADERS, list(values)], value_input_option="USER_ENTERED")

    if not _headers_match(history):
        if _is_blank(history):
            history.update(range_name="A1:I1", values=[HEADERS], value_input_option="USER_ENTERED")
        else:
            history.insert_row(HEADERS, index=1, value_input_option="USER_ENTERED")
    history.insert_row(list(values), index=2, value_input_option="USER_ENTERED")

    if _is_blank(guide):
        guide.update(range_name="A1", values=GUIDE_ROWS, value_input_option="USER_ENTERED")
