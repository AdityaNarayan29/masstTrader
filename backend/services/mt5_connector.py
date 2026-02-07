"""
MT5 Connection Layer using native MetaTrader5 Python package.
Direct IPC with MT5 terminal — full control, no third-party cloud.
Requires: Windows + MT5 terminal installed and running.
Docs: https://www.mql5.com/en/docs/python_metatrader5
"""
import MetaTrader5 as mt5
import pandas as pd
from datetime import datetime, timedelta


# MT5 timeframe constants mapping
TIMEFRAME_MAP = {
    "1m": mt5.TIMEFRAME_M1,
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "30m": mt5.TIMEFRAME_M30,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
    "1d": mt5.TIMEFRAME_D1,
    "1w": mt5.TIMEFRAME_W1,
}


class MT5Connector:
    def __init__(self):
        self._connected = False

    def connect(self, login: int = None, password: str = None, server: str = None,
                mt5_path: str = None) -> dict:
        """
        Initialize connection to MT5 terminal and login to account.

        Args:
            login: MT5 account number (int)
            password: MT5 account password
            server: MT5 broker server name (e.g. "Deriv-Demo")
            mt5_path: Optional path to MT5 terminal executable
        """
        # Initialize MT5 terminal
        init_kwargs = {}
        if mt5_path:
            init_kwargs["path"] = mt5_path
        if login:
            init_kwargs["login"] = int(login)
        if password:
            init_kwargs["password"] = password
        if server:
            init_kwargs["server"] = server

        if not mt5.initialize(**init_kwargs):
            error = mt5.last_error()
            raise ConnectionError(
                f"MT5 initialize() failed. Error code: {error[0]}, Description: {error[1]}"
            )

        # If credentials provided separately, do explicit login
        if login and password and server and not init_kwargs.get("login"):
            if not mt5.login(int(login), password=password, server=server):
                error = mt5.last_error()
                mt5.shutdown()
                raise ConnectionError(
                    f"MT5 login() failed. Error code: {error[0]}, Description: {error[1]}"
                )

        self._connected = True

        # Return terminal + account info
        terminal = mt5.terminal_info()
        version = mt5.version()
        return {
            "terminal_build": version[0] if version else None,
            "terminal_name": terminal.company if terminal else None,
            "connected": True,
        }

    def disconnect(self):
        """Shutdown MT5 connection."""
        mt5.shutdown()
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    def get_account_info(self) -> dict:
        """Get account balance, equity, margin, leverage, etc."""
        info = mt5.account_info()
        if info is None:
            raise RuntimeError(f"Failed to get account info: {mt5.last_error()}")
        return {
            "login": info.login,
            "name": info.name,
            "server": info.server,
            "balance": info.balance,
            "equity": info.equity,
            "margin": info.margin,
            "free_margin": info.margin_free,
            "leverage": info.leverage,
            "currency": info.currency,
            "profit": info.profit,
            "trade_mode": info.trade_mode,
        }

    def get_positions(self) -> list[dict]:
        """Get all open positions."""
        positions = mt5.positions_get()
        if positions is None:
            return []
        return [
            {
                "ticket": p.ticket,
                "symbol": p.symbol,
                "type": "buy" if p.type == mt5.ORDER_TYPE_BUY else "sell",
                "volume": p.volume,
                "open_price": p.price_open,
                "current_price": p.price_current,
                "profit": p.profit,
                "stop_loss": p.sl,
                "take_profit": p.tp,
                "open_time": datetime.fromtimestamp(p.time).strftime("%Y-%m-%d %H:%M:%S"),
                "swap": p.swap,
                "magic": p.magic,
                "comment": p.comment,
            }
            for p in positions
        ]

    def get_positions_by_symbol(self, symbol: str) -> list[dict]:
        """Get open positions for a specific symbol."""
        positions = mt5.positions_get(symbol=symbol)
        if positions is None:
            return []
        return [
            {
                "ticket": p.ticket,
                "symbol": p.symbol,
                "type": "buy" if p.type == mt5.ORDER_TYPE_BUY else "sell",
                "volume": p.volume,
                "open_price": p.price_open,
                "current_price": p.price_current,
                "profit": p.profit,
                "stop_loss": p.sl,
                "take_profit": p.tp,
                "open_time": datetime.fromtimestamp(p.time).strftime("%Y-%m-%d %H:%M:%S"),
            }
            for p in positions
        ]

    def get_history(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
        """
        Fetch historical OHLCV candle data using copy_rates_from_pos.
        Returns DataFrame with columns: datetime, open, high, low, close, volume
        """
        tf = TIMEFRAME_MAP.get(timeframe, mt5.TIMEFRAME_H1)
        rates = mt5.copy_rates_from_pos(symbol, tf, 0, bars)

        if rates is None or len(rates) == 0:
            error = mt5.last_error()
            raise RuntimeError(
                f"Failed to get rates for {symbol}: {error[0]} - {error[1]}"
            )

        df = pd.DataFrame(rates)
        df["time"] = pd.to_datetime(df["time"], unit="s")
        df = df.rename(columns={
            "time": "datetime",
            "tick_volume": "volume",
        })
        df = df.set_index("datetime")
        df = df[["open", "high", "low", "close", "volume"]]
        return df

    def get_history_range(self, symbol: str, timeframe: str,
                          date_from: datetime, date_to: datetime) -> pd.DataFrame:
        """Fetch historical candles within a specific date range."""
        tf = TIMEFRAME_MAP.get(timeframe, mt5.TIMEFRAME_H1)
        rates = mt5.copy_rates_range(symbol, tf, date_from, date_to)

        if rates is None or len(rates) == 0:
            error = mt5.last_error()
            raise RuntimeError(
                f"Failed to get rates for {symbol}: {error[0]} - {error[1]}"
            )

        df = pd.DataFrame(rates)
        df["time"] = pd.to_datetime(df["time"], unit="s")
        df = df.rename(columns={"time": "datetime", "tick_volume": "volume"})
        df = df.set_index("datetime")
        df = df[["open", "high", "low", "close", "volume"]]
        return df

    def get_ticks(self, symbol: str, count: int = 1000) -> pd.DataFrame:
        """Get recent ticks for a symbol."""
        ticks = mt5.copy_ticks_from(symbol, datetime.utcnow() - timedelta(hours=1),
                                     count, mt5.COPY_TICKS_ALL)
        if ticks is None or len(ticks) == 0:
            return pd.DataFrame()

        df = pd.DataFrame(ticks)
        df["time"] = pd.to_datetime(df["time"], unit="s")
        return df

    def get_trade_history(self, days: int = 30) -> list[dict]:
        """Fetch closed deal history."""
        date_from = datetime.utcnow() - timedelta(days=days)
        date_to = datetime.utcnow()

        deals = mt5.history_deals_get(date_from, date_to)
        if deals is None:
            return []

        trades = []
        for deal in deals:
            # Filter for actual trade entries/exits (not balance operations)
            if deal.entry in [mt5.DEAL_ENTRY_IN, mt5.DEAL_ENTRY_OUT]:
                trades.append({
                    "ticket": deal.ticket,
                    "order": deal.order,
                    "symbol": deal.symbol,
                    "type": "buy" if deal.type == mt5.DEAL_TYPE_BUY else "sell",
                    "volume": deal.volume,
                    "price": deal.price,
                    "profit": deal.profit,
                    "commission": deal.commission,
                    "swap": deal.swap,
                    "time": datetime.fromtimestamp(deal.time).strftime("%Y-%m-%d %H:%M:%S"),
                    "entry": "in" if deal.entry == mt5.DEAL_ENTRY_IN else "out",
                    "magic": deal.magic,
                    "comment": deal.comment,
                    "position_id": deal.position_id,
                })
        return trades

    def get_trade_history_by_symbol(self, symbol: str, days: int = 30) -> list[dict]:
        """Fetch closed deal history for a specific symbol."""
        all_trades = self.get_trade_history(days)
        return [t for t in all_trades if t["symbol"] == symbol]

    def get_symbol_info(self, symbol: str) -> dict:
        """Get detailed symbol information."""
        info = mt5.symbol_info(symbol)
        if info is None:
            raise RuntimeError(f"Symbol {symbol} not found. Error: {mt5.last_error()}")
        return {
            "symbol": info.name,
            "description": info.description,
            "point": info.point,
            "digits": info.digits,
            "spread": info.spread,
            "trade_mode": info.trade_mode,
            "volume_min": info.volume_min,
            "volume_max": info.volume_max,
            "volume_step": info.volume_step,
        }

    def get_symbol_price(self, symbol: str) -> dict:
        """Get current bid/ask tick for a symbol."""
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise RuntimeError(f"Failed to get tick for {symbol}: {mt5.last_error()}")
        return {
            "symbol": symbol,
            "bid": tick.bid,
            "ask": tick.ask,
            "last": tick.last,
            "volume": tick.volume,
            "time": datetime.fromtimestamp(tick.time).strftime("%Y-%m-%d %H:%M:%S"),
        }

    def get_symbols(self, group: str = None) -> list[str]:
        """
        Get list of available trading symbols.
        Optional group filter, e.g. "*USD*" or "Volatility*"
        """
        if group:
            symbols = mt5.symbols_get(group=group)
        else:
            symbols = mt5.symbols_get()

        if symbols is None:
            return []
        return [s.name for s in symbols]

    def select_symbol(self, symbol: str) -> bool:
        """Enable a symbol in MarketWatch (required before trading)."""
        return mt5.symbol_select(symbol, True)

    def place_trade(
        self,
        symbol: str,
        trade_type: str,
        volume: float,
        stop_loss: float = None,
        take_profit: float = None,
        deviation: int = 20,
        magic: int = 100000,
        comment: str = "MasstTrader",
    ) -> dict:
        """
        Place a market order.

        Args:
            symbol: Trading symbol (e.g. "EURUSD")
            trade_type: "buy" or "sell"
            volume: Lot size (e.g. 0.01)
            stop_loss: Stop loss price (absolute price, not pips)
            take_profit: Take profit price (absolute price, not pips)
            deviation: Maximum price deviation in points
            magic: Expert Advisor magic number for tracking
            comment: Order comment
        """
        # Ensure symbol is selected in MarketWatch
        self.select_symbol(symbol)

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise RuntimeError(f"Failed to get price for {symbol}")

        if trade_type == "buy":
            order_type = mt5.ORDER_TYPE_BUY
            price = tick.ask
        else:
            order_type = mt5.ORDER_TYPE_SELL
            price = tick.bid

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "price": price,
            "deviation": deviation,
            "magic": magic,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        if stop_loss is not None:
            request["sl"] = stop_loss
        if take_profit is not None:
            request["tp"] = take_profit

        # Check order before sending
        check = mt5.order_check(request)
        if check is None:
            raise RuntimeError(f"Order check failed: {mt5.last_error()}")
        if check.retcode != mt5.TRADE_RETCODE_DONE:
            # order_check returns 0 for valid, let's still try to send
            pass

        result = mt5.order_send(request)
        if result is None:
            raise RuntimeError(f"Order send failed: {mt5.last_error()}")

        return {
            "retcode": result.retcode,
            "order_id": result.order,
            "deal": result.deal,
            "volume": result.volume,
            "price": result.price,
            "comment": result.comment,
            "success": result.retcode == mt5.TRADE_RETCODE_DONE,
            "message": self._retcode_message(result.retcode),
        }

    def close_position(self, ticket: int) -> dict:
        """Close an open position by ticket number."""
        position = mt5.positions_get(ticket=ticket)
        if not position:
            raise RuntimeError(f"Position {ticket} not found")

        pos = position[0]
        # Reverse the trade to close
        close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
        tick = mt5.symbol_info_tick(pos.symbol)
        price = tick.bid if close_type == mt5.ORDER_TYPE_SELL else tick.ask

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": ticket,
            "price": price,
            "deviation": 20,
            "magic": 100000,
            "comment": "MasstTrader close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        result = mt5.order_send(request)
        if result is None:
            raise RuntimeError(f"Close failed: {mt5.last_error()}")

        return {
            "retcode": result.retcode,
            "success": result.retcode == mt5.TRADE_RETCODE_DONE,
            "message": self._retcode_message(result.retcode),
        }

    def modify_position(self, ticket: int, stop_loss: float = None,
                        take_profit: float = None) -> dict:
        """Modify SL/TP of an open position."""
        request = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": ticket,
        }
        if stop_loss is not None:
            request["sl"] = stop_loss
        if take_profit is not None:
            request["tp"] = take_profit

        result = mt5.order_send(request)
        if result is None:
            raise RuntimeError(f"Modify failed: {mt5.last_error()}")

        return {
            "retcode": result.retcode,
            "success": result.retcode == mt5.TRADE_RETCODE_DONE,
            "message": self._retcode_message(result.retcode),
        }

    def calc_margin(self, symbol: str, trade_type: str, volume: float) -> float:
        """Calculate required margin for a trade."""
        order_type = mt5.ORDER_TYPE_BUY if trade_type == "buy" else mt5.ORDER_TYPE_SELL
        tick = mt5.symbol_info_tick(symbol)
        price = tick.ask if trade_type == "buy" else tick.bid
        margin = mt5.order_calc_margin(order_type, symbol, volume, price)
        if margin is None:
            raise RuntimeError(f"Margin calc failed: {mt5.last_error()}")
        return margin

    def calc_profit(self, symbol: str, trade_type: str, volume: float,
                    price_open: float, price_close: float) -> float:
        """Calculate potential profit for a trade."""
        order_type = mt5.ORDER_TYPE_BUY if trade_type == "buy" else mt5.ORDER_TYPE_SELL
        profit = mt5.order_calc_profit(order_type, symbol, volume, price_open, price_close)
        if profit is None:
            raise RuntimeError(f"Profit calc failed: {mt5.last_error()}")
        return profit

    @staticmethod
    def _retcode_message(retcode: int) -> str:
        """Convert MT5 return code to human-readable message."""
        messages = {
            10009: "Order placed successfully",
            10013: "Invalid request",
            10014: "Invalid volume",
            10015: "Invalid price",
            10016: "Invalid stops",
            10017: "Trade disabled",
            10018: "Market closed",
            10019: "Not enough money",
            10020: "Price changed",
            10021: "No quotes",
            10026: "Auto trading disabled",
            10027: "Modification denied",
            10030: "Invalid fill type",
        }
        return messages.get(retcode, f"Unknown return code: {retcode}")
