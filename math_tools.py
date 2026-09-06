"""math_tools.py - Provides mathematical helper functions."""

def _validate_non_negative_integer(n: int, arg_name: str = "n") -> None:
    """Validate that input is an integer and non-negative."""
    # In Python, bool is a subclass of int (isinstance(True, int) is True)
    if isinstance(n, bool) or not isinstance(n, int):
        raise TypeError(f"{arg_name} must be an integer, got {type(n).__name__}")
    if n < 0:
        raise ValueError(f"{arg_name} must be a non-negative integer (>= 0)")


def factorial(n: int) -> int:
    """
    Calculate the factorial of a non-negative integer n (n!).
    
    0! = 1 by definition.
    """
    _validate_non_negative_integer(n, "n")
    if n == 0 or n == 1:
        return 1

    result = 1
    for i in range(2, n + 1):
        result *= i
    return result


def fibonacci(n: int) -> int:
    """
    Return the nth Fibonacci number using 0-indexing:
    F(0) = 0, F(1) = 1, F(2) = 1, F(3) = 2, ...
    
    Computed iteratively in O(n) time and O(1) space.
    """
    _validate_non_negative_integer(n, "n")
    if n == 0:
        return 0
    if n == 1:
        return 1

    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b


if __name__ == "__main__":
    for i in range(10):
        print(f"n={i} | factorial({i})={factorial(i):<8} | fibonacci({i})={fibonacci(i)}")
