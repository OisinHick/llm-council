import logging


def main():
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("llm_council")
    logger.info("Hello from llm-council!")


if __name__ == "__main__":
    main()
