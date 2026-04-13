// samples.js — CodeLink built-in code samples
// Each sample demonstrates common patterns the translator handles.

const SAMPLES = {
  python: `# Python sample — common patterns
def greet(name):
    print("Hello, " + name)

def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

def main():
    greet("World")
    
    x = 10
    y = 3.14
    message = "CodeLink"
    
    # For loop
    for i in range(5):
        print(i)
    
    # While loop
    count = 0
    while count < 3:
        print(count)
        count = count + 1
    
    # If / elif / else
    score = 85
    if score >= 90:
        print("Grade: A")
    elif score >= 80:
        print("Grade: B")
    elif score >= 70:
        print("Grade: C")
    else:
        print("Grade: F")
    
    # List
    numbers = [1, 2, 3, 4, 5]
    for num in numbers:
        print(num)
    
    result = factorial(5)
    print(result)

main()`,

  java: `// Java sample — common patterns
public class Main {

    public static void greet(String name) {
        System.out.println("Hello, " + name);
    }

    public static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);
    }

    public static void main(String[] args) {
        greet("World");

        int x = 10;
        double y = 3.14;
        String message = "CodeLink";

        // For loop
        for (int i = 0; i < 5; i++) {
            System.out.println(i);
        }

        // While loop
        int count = 0;
        while (count < 3) {
            System.out.println(count);
            count = count + 1;
        }

        // If / else if / else
        int score = 85;
        if (score >= 90) {
            System.out.println("Grade: A");
        } else if (score >= 80) {
            System.out.println("Grade: B");
        } else if (score >= 70) {
            System.out.println("Grade: C");
        } else {
            System.out.println("Grade: F");
        }

        int result = factorial(5);
        System.out.println(result);
    }
}`,

  cpp: `// C++ sample — common patterns
#include <iostream>
#include <string>
#include <vector>
using namespace std;

void greet(string name) {
    cout << "Hello, " + name << endl;
}

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main() {
    greet("World");

    int x = 10;
    double y = 3.14;
    string message = "CodeLink";

    // For loop
    for (int i = 0; i < 5; i++) {
        cout << i << endl;
    }

    // While loop
    int count = 0;
    while (count < 3) {
        cout << count << endl;
        count = count + 1;
    }

    // If / else if / else
    int score = 85;
    if (score >= 90) {
        cout << "Grade: A" << endl;
    } else if (score >= 80) {
        cout << "Grade: B" << endl;
    } else if (score >= 70) {
        cout << "Grade: C" << endl;
    } else {
        cout << "Grade: F" << endl;
    }

    int result = factorial(5);
    cout << result << endl;

    return 0;
}`,

  javascript: `// JavaScript sample — common patterns
function greet(name) {
    console.log("Hello, " + name);
}

function factorial(n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

function main() {
    greet("World");

    let x = 10;
    let y = 3.14;
    let message = "CodeLink";

    // For loop
    for (let i = 0; i < 5; i++) {
        console.log(i);
    }

    // While loop
    let count = 0;
    while (count < 3) {
        console.log(count);
        count = count + 1;
    }

    // If / else if / else
    let score = 85;
    if (score >= 90) {
        console.log("Grade: A");
    } else if (score >= 80) {
        console.log("Grade: B");
    } else if (score >= 70) {
        console.log("Grade: C");
    } else {
        console.log("Grade: F");
    }

    const numbers = [1, 2, 3, 4, 5];
    for (let num of numbers) {
        console.log(num);
    }

    let result = factorial(5);
    console.log(result);
}

main();`
};
