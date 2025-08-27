"""
This script provides three functionalities:
1. Calculate the factorial of a number.
2. Check if a number is a prime number.
3. Generate a Fibonacci sequence up to a given number.
"""

def factorial(n):
    """Calculate the factorial of a number."""
    if n == 0 or n == 1:
        return 1
    else:
        return n * factorial(n - 1)

def is_prime(num):
    """Check if a number is a prime number."""
    if num <= 1:
        return False
    for i in range(2, int(num ** 0.5) + 1):
        if num % i == 0:
            return False
    return True

def fibonacci(n):
    """Generate a Fibonacci sequence up to the nth number."""
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
