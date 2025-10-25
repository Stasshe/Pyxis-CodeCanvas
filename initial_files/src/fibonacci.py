"""
This script provides three functionalities using NumPy:
1. Calculate the factorial of a number.
2. Check if a number is a prime number.
3. Generate a Fibonacci sequence up to a given number.
"""

import numpy as np

def factorial(n):
    """Calculate the factorial of a number using NumPy."""
    return np.math.factorial(n)

def is_prime(num):
    """Check if a number is a prime number using NumPy."""
    if num <= 1:
        return False
    for i in range(2, int(np.sqrt(num)) + 1):
        if num % i == 0:
            return False
    return True

def fibonacci(n):
    """Generate a Fibonacci sequence up to the nth number using NumPy."""
    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence

# Example usage
if __name__ == "__main__":
    # Factorial
    num = 5
    print(f"The factorial of {num} is {factorial(num)}")

    # Prime check
    prime_candidate = 29
    print(f"Is {prime_candidate} a prime number? {'Yes' if is_prime(prime_candidate) else 'No'}")

    # Fibonacci sequence
    fib_count = 10
    print(f"The first {fib_count} numbers in the Fibonacci sequence are: {fibonacci(fib_count)}")