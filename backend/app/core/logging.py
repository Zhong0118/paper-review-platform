import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("paper-review")


class RedactAccessQueryFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if (isinstance(args, tuple) and len(args) == 5
                and record.msg == '%s - "%s %s HTTP/%s" %d'
                and all(isinstance(value, str) for value in args[:4])
                and isinstance(args[4], int)):
            client, method, target, protocol, status = args
            record.args = (client, method, target.partition('?')[0], protocol, status)
        else:
            record.msg = 'Access log omitted: unrecognized record'
            record.args = ()
        return True


def install_access_log_redaction() -> None:
    access = logging.getLogger('uvicorn.access')
    if not any(isinstance(item, RedactAccessQueryFilter) for item in access.filters):
        access.addFilter(RedactAccessQueryFilter())
